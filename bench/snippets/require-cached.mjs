// require() of a module that is already in require.cache, per kind of specifier.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const dir = mkdtempSync(join(tmpdir(), "require-cached-"));
mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
writeFileSync(join(dir, "child.cjs"), "module.exports = { value: 1 };");
writeFileSync(join(dir, "node_modules", "pkg", "package.json"), `{ "name": "pkg", "main": "index.js" }`);
writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;");

const require = createRequire(join(dir, "index.cjs"));
const absolute = require.resolve("./child.cjs");

bench(`require("./child.cjs")`, () => require("./child.cjs"));
bench(`require("pkg")`, () => require("pkg"));
bench(`require("/absolute/child.cjs")`, () => require(absolute));
bench(`require("node:fs")`, () => require("node:fs"));
bench(`require("fs")`, () => require("fs"));

await run();
