import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function download<V>(url: string): Promise<V> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status}: ${url}`);
  }
  return response.json();
}

type Protocol = {
  name: string;
  version: {
    major: number;
    minor: number;
  };
  domains: Domain[];
};

type Domain = {
  domain: string;
  types: Property[];
  commands?: {
    name: string;
    description?: string;
    parameters?: Property[];
    returns?: Property[];
  }[];
  events?: {
    name: string;
    description?: string;
    parameters: Property[];
  }[];
};

type Property = {
  id?: string;
  type?: string;
  name?: string;
  description?: string;
  optional?: boolean;
} & (
  | {
      type: "array";
      items?: Property;
    }
  | {
      type: "object";
      properties?: Property[];
    }
  | {
      type: "string";
      enum?: string[];
    }
  | {
      $ref: string;
    }
);

function format(property: Property): string {
  if (property.id) {
    const comment = property.description
      ? `/** ${property.description} */\n`
      : "";
    const body = format({ ...property, id: undefined });
    return `${comment}export type ${property.id} = ${body};\n`;
  }
  if (property.type === "array") {
    const type = "items" in property ? format(property.items!) : "unknown";
    return `Array<${type}>`;
  }
  if (property.type === "object") {
    if (!("properties" in property)) {
      return "Record<string, unknown>";
    }
    if (property.properties!.length === 0) {
      return "{}";
    }
    const properties = property
      .properties!.map((property) => {
        const comment = property.description
          ? `/** ${property.description} */\n`
          : "";
        const name = `${property.name}${property.optional ? "?" : ""}`;
        return `${comment}  ${name}: ${format(property)};`;
      })
      .join("\n");
    return `{\n${properties}}`;
  }
  if (property.type === "string") {
    if (!("enum" in property)) {
      return "string";
    }
    return property.enum!.map((v) => `"${v}"`).join(" | ");
  }
  if ("$ref" in property) {
    if (/^Page|DOM|Security|CSS|IO|Emulation\./.test(property.$ref)) {
      return "unknown";
    }
    return property.$ref;
  }
  if (property.type === "integer") {
    return "number";
  }
  return property.type;
}

function formatAll(protocol: Protocol): string {
  let body = "";
  const append = (property: Property) => {
    body += format(property);
  };
  const titlize = (name: string) =>
    name.charAt(0).toUpperCase() + name.slice(1);
  const events = new Map();
  const commands = new Map();
  for (const domain of protocol.domains) {
    body += `export namespace ${domain.domain} {`;
    for (const type of domain.types ?? []) {
      append(type);
    }
    for (const event of domain.events ?? []) {
      const symbol = `${domain.domain}.${event.name}`;
      const title = titlize(event.name);
      events.set(symbol, `${domain.domain}.${title}`);
      append({
        id: `${title}Event`,
        type: "object",
        description: `\`${symbol}\``,
        properties: event.parameters ?? [],
      });
    }
    for (const command of domain.commands ?? []) {
      const symbol = `${domain.domain}.${command.name}`;
      const title = titlize(command.name);
      commands.set(symbol, `${domain.domain}.${title}`);
      append({
        id: `${title}Request`,
        type: "object",
        description: `\`${symbol}\``,
        properties: command.parameters ?? [],
      });
      append({
        id: `${title}Response`,
        type: "object",
        description: `\`${symbol}\``,
        properties: command.returns ?? [],
      });
    }
    body += "};";
  }
  for (const type of ["Event", "Request", "Response"]) {
    const source = type === "Event" ? events : commands;
    append({
      id: `${type}Map`,
      type: "object",
      properties: [...source.entries()].map(([name, title]) => ({
        name: `"${name}"`,
        $ref: `${title}${type}`,
      })),
    });
  }
  body += `export type Event<T extends keyof EventMap> = {
    method: T;
    params: EventMap[T];
  };
  export type Request<T extends keyof RequestMap> = {
    id: number;
    method: T;
    params: RequestMap[T];
  };
  export type Response<T extends keyof ResponseMap> = {
    id: number;
  } & ({
    method?: T;
    result: ResponseMap[T];
  } | {
    error: {
      code?: string;
      message: string;
    };
  });`;
  return `export namespace ${protocol.name.toUpperCase()} {${body}};`;
}

async function downloadV8(): Promise<Protocol> {
  const baseUrl =
    "https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json";
  const filter = [
    "Runtime",
    "Network",
    "Console",
    "Debugger",
    "Profiler",
    "HeapProfiler",
  ];
  return Promise.all([
    download<Protocol>(`${baseUrl}/js_protocol.json`),
    download<Protocol>(`${baseUrl}/browser_protocol.json`),
  ]).then(([js, browser]) => ({
    name: "v8",
    version: js.version,
    domains: [...js.domains, ...browser.domains]
      .filter((domain) => filter.includes(domain.domain))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  }));
}

async function downloadJsc(): Promise<Protocol> {
  const baseUrl =
    "https://raw.githubusercontent.com/WebKit/WebKit/main/Source/JavaScriptCore/inspector/protocol";
  return {
    name: "jsc",
    version: {
      major: 1,
      minor: 3,
    },
    domains: await Promise.all([
      download<Domain>(`${baseUrl}/Debugger.json`),
      download<Domain>(`${baseUrl}/Heap.json`),
      download<Domain>(`${baseUrl}/ScriptProfiler.json`),
      download<Domain>(`${baseUrl}/Runtime.json`),
      download<Domain>(`${baseUrl}/Network.json`),
      download<Domain>(`${baseUrl}/Console.json`),
      download<Domain>(`${baseUrl}/GenericTypes.json`),
    ]).then((domains) =>
      domains.sort((a, b) => a.domain.localeCompare(b.domain))
    ),
  };
}

async function run(cwd: string) {
  const [jsc, v8] = await Promise.all([downloadJsc(), downloadV8()]);
  try {
    mkdirSync(cwd);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  const write = (name: string, data: string) => {
    writeFileSync(join(cwd, name), data);
    spawnSync("bunx", ["prettier", "--write", name], { cwd, stdio: "ignore" });
  };
  // Note: Can be uncommented to inspect the JSON protocol files.
  // write("devtools/jsc.json", JSON.stringify(jsc));
  // write("devtools/v8.json", JSON.stringify(v8));
  write("jsc.d.ts", "// GENERATED - DO NOT EDIT\n" + formatAll(jsc));
  write("v8.d.ts", "// GENERATED - DO NOT EDIT\n" + formatAll(v8));
}

run(join(__dirname, "..", "protocol"))
  .catch(console.error);
