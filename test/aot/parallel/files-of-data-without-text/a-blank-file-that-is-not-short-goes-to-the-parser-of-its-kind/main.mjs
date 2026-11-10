import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const show = value => typeof value + " " + JSON.stringify(value);
async function ask(label, load) {
  try {
    console.log("SAID", label, show(await load()));
  } catch (error) {
    console.log("SAID", label, "threw", error.name);
  }
}
await ask("jsonc tab by require", () => require("./tab.jsonc"));
await ask("jsonc tab by import", async () => (await import("./tab.jsonc")).default);
await ask("jsonc forty by require", () => require("./forty.jsonc"));
await ask("jsonc forty by import", async () => (await import("./forty.jsonc")).default);
await ask("jsonc short by require", () => require("./short.jsonc"));
await ask("jsonc short by import", async () => (await import("./short.jsonc")).default);
await ask("json5 tab by require", () => require("./tab.json5"));
await ask("json5 tab by import", async () => (await import("./tab.json5")).default);
await ask("json5 forty by require", () => require("./forty.json5"));
await ask("json5 forty by import", async () => (await import("./forty.json5")).default);
await ask("json5 short by require", () => require("./short.json5"));
await ask("json5 short by import", async () => (await import("./short.json5")).default);
await ask("toml tab by require", () => require("./tab.toml"));
await ask("toml tab by import", async () => (await import("./tab.toml")).default);
await ask("toml forty by require", () => require("./forty.toml"));
await ask("toml forty by import", async () => (await import("./forty.toml")).default);
await ask("toml short by require", () => require("./short.toml"));
await ask("toml short by import", async () => (await import("./short.toml")).default);
await ask("yaml tab by require", () => require("./tab.yaml"));
await ask("yaml tab by import", async () => (await import("./tab.yaml")).default);
await ask("yaml forty by require", () => require("./forty.yaml"));
await ask("yaml forty by import", async () => (await import("./forty.yaml")).default);
await ask("yaml short by require", () => require("./short.yaml"));
await ask("yaml short by import", async () => (await import("./short.yaml")).default);
await ask("xml tab by require", () => require("./tab.xml"));
await ask("xml tab by import", async () => (await import("./tab.xml")).default);
await ask("xml forty by require", () => require("./forty.xml"));
await ask("xml forty by import", async () => (await import("./forty.xml")).default);
await ask("xml short by require", () => require("./short.xml"));
await ask("xml short by import", async () => (await import("./short.xml")).default);
