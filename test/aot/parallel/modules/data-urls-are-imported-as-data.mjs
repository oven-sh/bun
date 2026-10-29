// A data: URL that is imported as JSON, as text or as another kind of data is a module with what the URL holds, whether a statement imports it or import().
import json from 'data:application/json,{"a":1}' with { type: "json" };
import { a } from 'data:application/json,{"a":4}' with { type: "json" };
import * as everything from 'data:application/json,{"a":5,"b":[6]}' with { type: "json" };
import { default as renamed } from 'data:application/json,{"a":7}' with { type: "json" };
import base64 from "data:application/json;base64,eyJhIjoyfQ==" with { type: "json" };
import text from "data:text/plain,three words here" with { type: "text" };
console.log(
  JSON.stringify(json),
  JSON.stringify(base64),
  text,
  a,
  Object.keys(everything).join(),
  JSON.stringify(everything.default),
  renamed.a,
);
const attempt = async (what, load) => {
  try {
    const loaded = await load();
    console.log(what + ":", JSON.stringify(loaded.default), Object.keys(loaded).join());
  } catch (error) {
    console.log(what + ": failed:", error.constructor.name);
  }
};
await attempt("JSON", () => import('data:application/json,{"a":11}', { with: { type: "json" } }));
await attempt("JSON in base64", () => import("data:application/json;base64,eyJhIjoxMn0=", { with: { type: "json" } }));
await attempt(
  "JSON with escapes",
  () => import("data:application/json,%7B%22a%22%3A13%7D", { with: { type: "json" } }),
);
await attempt(
  "JSON with a character set",
  () => import('data:application/json;charset=utf-8,{"a":14}', { with: { type: "json" } }),
);
await attempt(
  "JSON that holds slashes and dots",
  () => import('data:application/json,{"a/b":"c/../d//e.json"}', { with: { type: "json" } }),
);
await attempt("a list", () => import("data:application/json,[1,2,15]", { with: { type: "json" } }));
await attempt("a number", () => import("data:application/json,16", { with: { type: "json" } }));
await attempt("text", () => import("data:text/plain,hello 17", { with: { type: "text" } }));
await attempt("text in base64", () => import("data:text/plain;base64,aGVsbG8gMTg=", { with: { type: "text" } }));
await attempt("no text", () => import("data:text/plain,", { with: { type: "text" } }));
await attempt("text outside ASCII", () => import("data:text/plain,%E2%9C%93 ✓ 19", { with: { type: "text" } }));
await attempt("a URL that names no type", () => import("data:,20", { with: { type: "text" } }));
await attempt("JavaScript as text", () => import("data:text/javascript,export default 21", { with: { type: "text" } }));
await attempt("JSON as text", () => import('data:application/json,{"a":22}', { with: { type: "text" } }));
await attempt("TOML", () => import("data:application/toml,a = 23", { with: { type: "toml" } }));
await attempt("YAML", () => import("data:application/yaml,a: 24", { with: { type: "yaml" } }));
await attempt("JSON5", () => import("data:application/json5,{a: 25}", { with: { type: "json5" } }));
const first = await import('data:application/json,{"a":11}', { with: { type: "json" } });
const second = await import('data:application/json,{"a":11}', { with: { type: "json" } });
console.log("one module:", first === second);
