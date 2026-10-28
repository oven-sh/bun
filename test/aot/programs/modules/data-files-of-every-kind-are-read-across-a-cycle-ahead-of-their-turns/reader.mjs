import "./caller.mjs";
import json from "./data.json";
import jsonc from "./data.jsonc";
import json5 from "./data.json5";
import toml from "./data.toml";
import yaml from "./data.yaml";
import text from "./data.txt";
import file from "./data.bin" with { type: "file" };
import css from "./data.css";
import xml from "./data.xml";
import markdown from "./data.md";
import { a as named } from "./data.toml";
import * as all from "./data.yaml";
export function readers() {
  return {
    json: () => JSON.stringify(json),
    jsonc: () => JSON.stringify(jsonc),
    json5: () => JSON.stringify(json5),
    toml: () => JSON.stringify(toml),
    yaml: () => JSON.stringify(yaml),
    text: () => text,
    file: () => typeof file,
    css: () => JSON.stringify(css),
    xml: () => JSON.stringify(xml),
    markdown: () => markdown,
    named: () => named,
    all: () => Object.keys(all).join() + JSON.stringify(all.default),
  };
}
console.log("reader runs");
