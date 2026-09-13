// Regenerates src/protocol/jsc/{protocol.json,index.d.ts} from the inspector
// protocol of the WebKit build Bun links against.
//
//   bun scripts/generate-protocol.ts [path/to/CombinedDomains.json] [--v8]
//
// CombinedDomains.json is what JavaScriptCore's build produces from
// Source/JavaScriptCore/inspector/protocol/*.json. The bun-webkit prebuilt
// tarball ships it at its top level, so after `bun bd` it can be found in the
// build cache for the WEBKIT_VERSION pinned in scripts/build/deps/webkit.ts;
// that is what is used when no path is given. A local WebKit build writes it
// to <build>/JavaScriptCore/DerivedSources/CombinedDomains.json.
//
// Pass --v8 to also refresh src/protocol/v8 from the Chrome DevTools protocol
// repository (requires network access).
//
// test/cli/inspect/bun-inspector-protocol.test.ts imports the exported functions
// and checks the generated files, so only the `import.meta.main` block below may
// have side effects.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Domain, Property, Protocol } from "../src/protocol/schema";

export function formatProtocol(protocol: Protocol, extraTs?: string): string {
  const { name, domains } = protocol;
  const eventMap = new Map();
  const commandMap = new Map();
  let body = `export namespace ${name} {`;
  for (const { domain, types = [], events = [], commands = [] } of domains) {
    body += `export namespace ${domain} {`;

    for (const type of types) {
      body += formatProperty(type);
    }
    for (const { name, description, parameters = [] } of events) {
      const symbol = `${domain}.${name}`;
      const title = toTitle(name);
      eventMap.set(symbol, `${domain}.${title}`);
      body += formatProperty({
        id: `${title}Event`,
        type: "object",
        description: `${description}\n@event \`${symbol}\``,
        properties: parameters,
      });
    }
    for (const { name, description, parameters = [], returns = [] } of commands) {
      const symbol = `${domain}.${name}`;
      const title = toTitle(name);
      commandMap.set(symbol, `${domain}.${title}`);
      body += formatProperty({
        id: `${title}Request`,
        type: "object",
        description: `${description}\n@request \`${symbol}\``,
        properties: parameters,
      });
      body += formatProperty({
        id: `${title}Response`,
        type: "object",
        description: `${description}\n@response \`${symbol}\``,
        properties: returns,
      });
    }
    body += "}";
  }
  for (const type of ["Event", "Request", "Response"]) {
    const sourceMap = type === "Event" ? eventMap : commandMap;
    body += formatProperty({
      id: `${type}Map`,
      type: "object",
      properties: [...sourceMap.entries()].map(([name, title]) => ({
        name: `"${name}"`,
        type: undefined,
        $ref: `${title}${type}`,
      })),
    });
  }
  if (extraTs) {
    body += extraTs;
  }
  return body + "}";
}

function formatProperty(property: Property): string {
  const { id, description, type, optional } = property;
  let body = "";
  if (id) {
    if (description) {
      body += `\n${toComment(description)}\n`;
    }
    body += `export type ${id}=`;
  }
  if (type === "boolean") {
    body += "boolean";
  } else if (type === "number" || type === "integer") {
    body += "number";
  } else if (type === "string") {
    const { enum: choices } = property;
    if (choices) {
      body += choices.map(value => `"${value}"`).join("|");
    } else {
      body += "string";
    }
  } else if (type === "array") {
    const { items } = property;
    const itemType = items ? formatProperty(items) : "unknown";
    body += `${itemType}[]`;
  } else if (type === "object") {
    const { properties } = property;
    if (!properties) {
      body += "Record<string, unknown>";
    } else if (properties.length === 0) {
      body += "{}";
    } else {
      body += "{";
      for (const { name, description, ...property } of properties) {
        if (description) {
          body += `\n${toComment(description)}`;
        }
        const delimit = property.optional ? "?:" : ":";
        body += `\n${name}${delimit}${formatProperty({ ...property, id: undefined })};`;
      }
      body += "}";
    }
  } else if ("$ref" in property) {
    body += property.$ref;
  } else {
    body += "unknown";
  }
  if (optional) {
    body += "|undefined";
  }
  if (id) {
    body += ";";
  }
  return body;
}

/**
 * Besides a type of the referring domain (`RemoteObject`) or of another one (`Network.RequestId`), a
 * `$ref` may name one of these, the types WebKit's protocol generator predeclares
 * (inspector/scripts/codegen/models.py, resolve_types): Runtime.PropertyDescriptor.isPrivate is a
 * `$ref` to `boolean`. There is nothing to declare for them.
 */
export const primitiveTypes: ReadonlySet<string> = new Set(["any", "boolean", "integer", "number", "object", "string"]);

/**
 * The domains of the snapshot: those of `all` (a CombinedDomains.json) that a JavaScript debuggable (a bun
 * process, as opposed to a web page or a service worker) speaks, by the rule WebKit's own frontend applies
 * in InspectorBackend.activateDomain (a domain applies to the debuggable types it lists, and one that lists
 * none, like GenericTypes, applies to every debuggable), except `domainsWithoutAgent`; plus the types they
 * refer to in the remaining domains.
 */
export function selectJscDomains(all: readonly Domain[], domainsWithoutAgent: ReadonlySet<string>): Domain[] {
  const selected = all.filter(
    ({ domain, debuggableTypes }) =>
      (debuggableTypes === undefined || debuggableTypes.includes("javascript")) && !domainsWithoutAgent.has(domain),
  );
  return withReferencedTypes(selected, all);
}

/**
 * `selected`, plus a types-only copy of every other domain of `all` whose types they `$ref`
 * (Console.ConsoleMessage has a Network.RequestId, although Network itself is a web page domain),
 * holding just the referenced types and whatever those refer to in turn. Without them, index.d.ts
 * names namespaces it does not declare, which every consumer compiles with skipLibCheck, so the
 * affected properties silently type-check as anything.
 */
function withReferencedTypes(selected: readonly Domain[], all: readonly Domain[]): Domain[] {
  const allByName = new Map(all.map(domain => [domain.domain, domain]));
  const selectedNames = new Set(selected.map(domain => domain.domain));
  /** Domain name to the ids of its types that `selected` refers to, for domains outside `selected`. */
  const referenced = new Map<string, Set<string>>();

  function visit(property: Property, domain: string): void {
    if ("$ref" in property) {
      const { $ref } = property;
      const [refDomain, id] = $ref.includes(".") ? $ref.split(".") : [domain, $ref];
      if (selectedNames.has(refDomain)) {
        return;
      }
      const type = allByName.get(refDomain)?.types?.find(type => type.id === id);
      if (!type) {
        if (primitiveTypes.has($ref)) {
          return;
        }
        throw new Error(`${domain} refers to ${$ref}, which no domain declares`);
      }
      const ids = referenced.get(refDomain) ?? new Set();
      referenced.set(refDomain, ids);
      if (!ids.has(id)) {
        ids.add(id);
        visit(type, refDomain);
      }
    } else if (property.type === "array") {
      if (property.items) {
        visit(property.items, domain);
      }
    } else if (property.type === "object") {
      for (const member of property.properties ?? []) {
        visit(member, domain);
      }
    }
  }

  for (const { domain, types = [], commands = [], events = [] } of selected) {
    for (const type of types) {
      visit(type, domain);
    }
    for (const { parameters = [], returns = [] } of commands) {
      for (const property of [...parameters, ...returns]) {
        visit(property, domain);
      }
    }
    for (const { parameters = [] } of events) {
      for (const property of parameters) {
        visit(property, domain);
      }
    }
  }

  const referencedDomains = [...referenced].map(([name, ids]): Domain => {
    const { debuggableTypes, types = [] } = allByName.get(name)!;
    return {
      domain: name,
      description: "Only the types that the other domains of this snapshot refer to.",
      debuggableTypes,
      types: types.filter(type => ids.has(type.id!)),
    };
  });
  return [...selected, ...referencedDomains].sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * @link https://github.com/ChromeDevTools/devtools-protocol/tree/master/json
 */
async function downloadV8(): Promise<Protocol> {
  const baseUrl = "https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json";
  const domains = ["Runtime", "Console", "Debugger", "Memory", "HeapProfiler", "Profiler", "Network", "Inspector"];
  return Promise.all([
    download<Protocol>(`${baseUrl}/js_protocol.json`),
    download<Protocol>(`${baseUrl}/browser_protocol.json`),
  ]).then(([js, browser]) => ({
    name: "V8",
    version: js.version,
    domains: [...js.domains, ...browser.domains]
      .filter(domain => !domains.includes(domain.domain))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  }));
}

async function download<V>(url: string): Promise<V> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status}: ${url}`);
  }
  return response.json();
}

function toTitle(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function toComment(description?: string): string {
  if (!description) {
    return "";
  }
  const lines = ["/**", ...description.split("\n").map(line => ` * ${line.trim()}`), "*/"];
  return lines.join("\n");
}

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

/** The CombinedDomains.json of the prebuilt WebKit pinned by scripts/build/deps/webkit.ts, if it has been downloaded. */
function findPinnedCombinedDomains(): string | undefined {
  const webkitTs = readFileSync(path.join(repoRoot, "scripts", "build", "deps", "webkit.ts"), "utf-8");
  const version = /^export const WEBKIT_VERSION = "([^"]+)";/m.exec(webkitTs)?.[1];
  if (!version) {
    throw new Error("Could not find WEBKIT_VERSION in scripts/build/deps/webkit.ts");
  }
  // Mirrors prebuiltDestDir() in scripts/build/deps/webkit.ts:
  // <cache>/webkit-<version>[-<os>][-<arch>][-debug|-lto][-asan]/
  const dirVersion = version.startsWith("autobuild-") ? version.slice("autobuild-".length) : version.slice(0, 16);
  const bunInstall = process.env.BUN_INSTALL
    ? path.resolve(repoRoot, process.env.BUN_INSTALL)
    : path.join(homedir(), ".bun");
  const cacheDir = path.join(bunInstall, "build-cache");
  if (!existsSync(cacheDir)) {
    return undefined;
  }
  const glob = new Bun.Glob(`webkit-${dirVersion}*/CombinedDomains.json`);
  const [match] = [...glob.scanSync({ cwd: cacheDir })].sort();
  return match && path.join(cacheDir, match);
}

/**
 * Domains that Bun's WebKit fork declares as debuggable from JavaScript, but that bun registers no
 * agent for (see src/jsc/bindings/BunDebugger.cpp): bun answers every command in them with
 * "'<domain>' domain was not found". test/cli/inspect/bun-inspector-protocol.test.ts checks that
 * this is still true, so remove a domain from here once bun implements it.
 */
const domainsWithoutAgent = new Set(["File", "Process"]);

if (import.meta.main) {
  const args = process.argv.slice(2);
  const includeV8 = args.includes("--v8");
  const combinedDomainsPath = args.find(arg => !arg.startsWith("--")) ?? findPinnedCombinedDomains();
  if (!combinedDomainsPath) {
    console.error(
      "Could not find CombinedDomains.json for the pinned WebKit version. " +
        "Run `bun bd` first or pass the path to a WebKit build's CombinedDomains.json.",
    );
    process.exit(1);
  }
  console.log(`Reading ${combinedDomainsPath}`);
  const combinedDomains: { domains: Domain[] } = await Bun.file(combinedDomainsPath).json();

  const protocolDir = path.resolve(import.meta.dir, "..", "src", "protocol");
  const written: string[] = [];
  const write = (name: string, data: string) => {
    const filePath = path.join(protocolDir, name);
    writeFileSync(filePath, data);
    written.push(filePath);
  };
  const base = readFileSync(path.join(protocolDir, "protocol.d.ts"), "utf-8");
  const baseNoComments = base.replace(/\/\/.*/g, "");

  const jsc: Protocol = {
    name: "JSC",
    version: {
      major: 1,
      minor: 4,
    },
    domains: selectJscDomains(combinedDomains.domains, domainsWithoutAgent),
  };
  write("jsc/protocol.json", JSON.stringify(jsc, null, 2));
  write("jsc/index.d.ts", "// GENERATED - DO NOT EDIT\n" + formatProtocol(jsc, baseNoComments));

  if (includeV8) {
    const v8 = await downloadV8();
    write("v8/protocol.json", JSON.stringify(v8));
    write("v8/index.d.ts", "// GENERATED - DO NOT EDIT\n" + formatProtocol(v8, baseNoComments));
  }

  const { status } = spawnSync("bunx", ["prettier", "--write", ...written], { cwd: repoRoot, stdio: "inherit" });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}
