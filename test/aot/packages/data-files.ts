// JSON, text, TOML and YAML files as modules; a missing native addon, with a fallback in JavaScript; optional dependencies that are not installed.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "assets",
    files: {
      ...pkg("assets", {
        "data.json": `{ "name": "data", "list": [1, 2, 3], "nested": { "k": true, "n": null }, "big": 12345678901234567890, "float": 1.5e3, "neg": -0, "__proto__": { "polluted": true }, "dup": 1, "dup": 2, "a-b": "dash", "default": "a key called default", "": "empty", "unicode": "\\u00e9\\ud83d\\ude00" }
`,
        "array.json": `[1, "two", { "three": 3 }]
`,
        "string.json": `"just a string"
`,
        "number.json": `42
`,
        "null.json": `null
`,
        "empty_object.json": `{}
`,
        "text.txt": `line one
line two
`,
        "conf.toml": `title = "toml"
[owner]
name = "me"
n = 3
`,
        "c.jsonc": `{ // a comment
  "a": 1, /* more */ "b": [1, 2,],
}
`,
        "y.yaml": `name: yaml
list:
  - 1
  - two
`,
        "native.js": `let binding;
try { binding = require("./build/Release/addon.node"); } catch (e) { binding = require("./fallback.js"); binding.why = e.code || e.name; }
module.exports = binding;
`,
        "fallback.js": `exports.kind = "the JavaScript fallback";
`,
        "native_by_platform.js": `const name = "./prebuilds/" + process.platform + "-" + process.arch + "/addon.node";
let b; try { b = require(name); } catch (e) { b = { kind: "none for this platform", why: e.code || e.name }; }
module.exports = b;
`,
        "optional.js": `let o; try { o = require("not-installed-anywhere"); } catch (e) { o = { kind: "absent", why: e.code }; }
module.exports = o;
module.exports.also = (() => { try { return require.resolve("not-installed-anywhere"); } catch (e) { return e.code; } })();
`,
        "optional.mjs": `let o; try { o = await import("not-installed-anywhere"); } catch (e) { o = { kind: "absent", why: e.code || e.name }; }
export default o;
`,
        "optional_peer.js": `function has(n) { try { require.resolve(n); return true; } catch { return false; } }
module.exports = { has: [has("assets"), has("not-installed-anywhere"), has("node:fs"), has("./fallback.js")] };
`,
      }),
    },
    importers: {
      "json_default.mjs": `import d from "assets/data.json";
${js}t("d", () => d); t("keys", () => Object.keys(d).join()); t("proto", () => [d.polluted, Object.getPrototypeOf(d) === Object.prototype, Object.hasOwn(d, "__proto__")]); t("neg", () => Object.is(d.neg, -0)); t("big", () => d.big);
`,
      "json_names.mjs": `import { name, list, nested, dup, "a-b" as ab, default as d } from "assets/data.json";
${js}t("x", () => [name, list, nested, dup, ab, typeof d]);
`,
      "json_ns.mjs": `import * as ns from "assets/data.json";
${js}t("x", () => [keys(ns), ns.name, typeof ns.default]);
`,
      "json_with.mjs": `import d from "assets/data.json" with { type: "json" };
${js}t("x", () => d.name);
`,
      "json_req.cjs": `${js}const d = require("assets/data.json");
t("d", () => d); t("same", () => d === require("assets/data.json")); d.name = "changed"; t("changed", () => require("assets/data.json").name);
`,
      "json_shared.mjs": `import d from "assets/data.json";
${js}d.list.push(4);
t("req", () => require("assets/data.json").list);
await ta("dyn", () => import("assets/data.json").then((m) => [m.default === d, m.default.list]));
t("frozen", () => [Object.isFrozen(d), Object.isFrozen(d.list)]);
`,
      "json_kinds.mjs": `import a from "assets/array.json";
import s from "assets/string.json";
import n from "assets/number.json";
import z from "assets/null.json";
import e from "assets/empty_object.json";
${js}t("x", () => [a, Array.isArray(a), s, n, z, e]);
`,
      "json_kinds.cjs": `${js}t("x", () => ["array", "string", "number", "null", "empty_object"].length);
t("a", () => require("assets/array.json")); t("s", () => require("assets/string.json")); t("n", () => require("assets/number.json")); t("z", () => require("assets/null.json"));
`,
      "json.ts": `import d from "assets/data.json";
${ts}t("x", () => [d.name.length, d.list.map((x) => x + 1), d.nested.k, d.nested.n, d.float + 1, d.dup + 1, d.big]);
const copy: { name: string; list: number[] } = d;
t("copy", () => [copy.name, copy.list.length]);
d.list.push(9);
t("pushed", () => [d.list.length, copy.list[3]]);
`,
      "json_array.ts": `import a from "assets/array.json";
${ts}t("x", () => [a.length, a[0], a[1], a[2]]);
for (const x of a) console.log(typeof x);
`,
      "json_dyn.ts": `${ts}const m = await import("assets/data.json");
t("x", () => [m.default.name, m.default.list.length + 1]);
export {};
`,
      "text.mjs": `import s from "assets/text.txt";
${js}t("x", () => [typeof s, s]);
`,
      "text_with.mjs": `import s from "assets/data.json" with { type: "text" };
${js}t("x", () => [typeof s, s.length]);
`,
      "text_req.cjs": `${js}t("x", () => require("assets/text.txt"));
`,
      "toml.mjs": `import c, { title, owner } from "assets/conf.toml";
${js}t("x", () => [c, title, owner]);
`,
      "jsonc.mjs": `import c from "assets/c.jsonc";
${js}t("x", () => c);
`,
      "yaml.mjs": `import c from "assets/y.yaml";
${js}t("x", () => c);
`,
      "file_with.mjs": `import p from "assets/text.txt" with { type: "file" };
${js}t("x", () => [typeof p, p.split("/").pop().replace(/-[a-z0-9]+\\./, ".")]);
await ta("read", () => Bun.file(p).text());
`,
      "native.cjs": `${js}t("x", () => require("assets/native.js"));
`,
      "native.mjs": `import b from "assets/native.js";
${js}t("x", () => b);
`,
      "native_by_platform.cjs": `${js}t("x", () => require("assets/native_by_platform.js"));
`,
      "optional.cjs": `${js}t("x", () => require("assets/optional.js"));
`,
      "optional.mjs": `import o from "assets/optional.mjs";
${js}t("x", () => o);
`,
      "optional_from_esm.mjs": `import o from "assets/optional.js";
${js}t("x", () => o);
`,
      "optional_peer.cjs": `${js}t("x", () => require("assets/optional_peer.js"));
`,
    },
  },
];
