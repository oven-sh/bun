import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { Domain, Property, Protocol } from "../src/protocol/schema";

run().catch(console.error);

async function run() {
  const cwd = new URL("../src/protocol/", import.meta.url);
  const runner = "Bun" in globalThis ? "bunx" : "npx";
  const write = (name: string, data: string) => {
    const path = new URL(name, cwd);
    writeFileSync(path, data);
    spawnSync(runner, ["prettier", "--write", path.pathname], { cwd, stdio: "ignore" });
  };
  const base = readFileSync(new URL("protocol.d.ts", cwd), "utf-8");
  const baseNoComments = base.replace(/\/\/.*/g, "");
  const jsc = await downloadJsc();
  write("jsc/protocol.json", JSON.stringify(jsc));
  write("jsc/index.d.ts", "// GENERATED - DO NOT EDIT\n" + formatProtocol(jsc, baseNoComments));
  const v8 = await downloadV8();
  write("v8/protocol.json", JSON.stringify(v8));
  write("v8/index.d.ts", "// GENERATED - DO NOT EDIT\n" + formatProtocol(v8, baseNoComments));
}

function formatProtocol(protocol: Protocol, extraTs?: string): string {
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
    body += "};";
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
  return body + "};";
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

/**
 * @link https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/inspector/protocol
 */
async function downloadJsc(): Promise<Protocol> {
  const baseUrl = "https://raw.githubusercontent.com/WebKit/WebKit/main/Source/JavaScriptCore/inspector/protocol";
  const domains = [
    "Runtime",
    "Console",
    "Debugger",
    "Heap",
    "ScriptProfiler",
    "CPUProfiler",
    "GenericTypes",
    "Network",
    "Inspector",
  ];
  return {
    name: "JSC",
    version: {
      major: 1,
      minor: 3,
    },
    domains: await Promise.all(domains.map(domain => download<Domain>(`${baseUrl}/${domain}.json`))).then(domains =>
      domains.sort((a, b) => a.domain.localeCompare(b.domain)),
    ),
  };
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
