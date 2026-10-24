// Text toml jsonc yaml and json5 files are imported.
import text from "./a.txt";
import toml from "./a.toml";
import jsonc from "./a.jsonc";
import yaml from "./a.yaml";
import asText from "./a.json" with { type: "text" };
import json5 from "./a.json5";
console.log(JSON.stringify([text, toml, jsonc, yaml, asText, json5]));
