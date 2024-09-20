import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Protocol, Type } from "../src/protocol/schema";

run().catch(console.error);

async function run() {
  const cwd = new URL("../src/protocol/", import.meta.url);
  const runner = "Bun" in globalThis ? "bunx" : "npx";
  const write = (name: string, data: string) => {
    const path = new URL(name, cwd);
    writeFileSync(path, data);
    spawnSync(runner, ["prettier", "--write", path.pathname], { cwd, stdio: "ignore" });
  };
  const schema: Protocol = await download(
    "https://microsoft.github.io/debug-adapter-protocol/debugAdapterProtocol.json",
  );
  write("protocol.json", JSON.stringify(schema));
  const types = formatProtocol(schema);
  write("index.d.ts", `// GENERATED - DO NOT EDIT\n${types}`);
}

function formatProtocol(protocol: Protocol, extraTs?: string): string {
  const { definitions } = protocol;
  const requestMap = new Map();
  const responseMap = new Map();
  const eventMap = new Map();
  let body = `export namespace DAP {`;
  loop: for (const [key, definition] of Object.entries(definitions)) {
    if (/[a-z]+Request$/i.test(key)) {
      continue;
    }
    if (/[a-z]+Arguments$/i.test(key)) {
      const name = key.replace(/(Request)?Arguments$/, "");
      const requestName = `${name}Request`;
      requestMap.set(toMethod(name), requestName);
      body += formatType(definition, requestName);
      continue;
    }
    if ("allOf" in definition) {
      const { allOf } = definition;
      for (const type of allOf) {
        if (type.type !== "object") {
          continue;
        }
        const { description, properties = {} } = type;
        if (/[a-z]+Event$/i.test(key)) {
          const { event, body: type = {} } = properties;
          if (!event || !("enum" in event)) {
            continue;
          }
          const [eventKey] = event.enum ?? [];
          eventMap.set(eventKey, key);
          const eventType: Type = {
            type: "object",
            description,
            ...type,
          };
          body += formatType(eventType, key);
          continue loop;
        }
        if (/[a-z]+Response$/i.test(key)) {
          const { body: type = {} } = properties;
          const bodyType: Type = {
            type: "object",
            description,
            ...type,
          };
          const name = key.replace(/Response$/, "");
          responseMap.set(toMethod(name), key);
          body += formatType(bodyType, key);
          continue loop;
        }
      }
    }
    body += formatType(definition, key);
  }
  for (const [key, name] of responseMap) {
    if (requestMap.has(key)) {
      continue;
    }
    const requestName = `${name.replace(/Response$/, "")}Request`;
    requestMap.set(key, requestName);
    body += formatType({ type: "object", properties: {} }, requestName);
  }
  body += formatMapType("RequestMap", requestMap);
  body += formatMapType("ResponseMap", responseMap);
  body += formatMapType("EventMap", eventMap);
  if (extraTs) {
    body += extraTs;
  }
  return body + "};";
}

function formatMapType(key: string, typeMap: Map<string, string>): string {
  const type: Type = {
    type: "object",
    required: [...typeMap.keys()],
    properties: Object.fromEntries([...typeMap.entries()].map(([key, value]) => [key, { $ref: value }])),
  };
  return formatType(type, key);
}

function formatType(type: Type, key?: string): string {
  const { description, type: kind } = type;
  let body = "";
  if (key) {
    if (description) {
      body += `\n${toComment(description)}\n`;
    }
    body += `export type ${key}=`;
  }
  if (kind === "boolean") {
    body += "boolean";
  } else if (kind === "number" || kind === "integer") {
    body += "number";
  } else if (kind === "string") {
    const { enum: choices } = type;
    if (choices) {
      body += choices.map(value => `"${value}"`).join("|");
    } else {
      body += "string";
    }
  } else if (kind === "array") {
    const { items } = type;
    const itemType = items ? formatType(items) : "unknown";
    body += `${itemType}[]`;
  } else if (kind === "object") {
    const { properties, required } = type;
    if (!properties || Object.keys(properties).length === 0) {
      body += "{}";
    } else {
      body += "{";
      for (const [key, { description, ...type }] of Object.entries(properties)) {
        if (description) {
          body += `\n${toComment(description)}`;
        }
        const delimit = required?.includes(key) ? ":" : "?:";
        body += `\n${key}${delimit}${formatType(type)};`;
      }
      body += "}";
    }
  } else if ("$ref" in type) {
    const { $ref: ref } = type;
    body += ref.split("/").pop() || "unknown";
  } else if ("allOf" in type) {
    const { allOf } = type;
    body += allOf.map(type => formatType(type)).join("&");
  } else {
    body += "unknown";
  }
  if (key) {
    body += ";";
  }
  return body;
}

function toMethod(name: string): string {
  return `${name.substring(0, 1).toLowerCase()}${name.substring(1)}`;
}

function toComment(description?: string): string {
  if (!description) {
    return "";
  }
  const lines = ["/**", ...description.split("\n").map(line => ` * ${line.trim()}`), "*/"];
  return lines.join("\n");
}

async function download<T>(url: string | URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  return response.json();
}
