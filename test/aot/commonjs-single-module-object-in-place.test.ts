import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const says = `const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
`;

const files = {
  "child.cjs": `exports.parent = module.parent;\nexports.own = module;\n`,
  "other.cjs": `exports.parent = module.parent;\n`,
  "computed-first.cjs": `${says}const name = ["./child", ".cjs"].join("");
const child = require(name);
require("./child.cjs");
say("the parent of the child is this module", child.parent === module);
say("children", module.children.map(each => base(each.filename)));
say("it is the main one", require.main === module);
`,
  "computed-only.cjs": `${says}const names = ["./child", "./other"].map(name => name + ".cjs");
const [child, other] = names.map(name => require(name));
say("parents", [child.parent === module, other.parent === module]);
say("children", module.children.map(each => base(each.filename)));
`,
  "handed-on.cjs": `${says}const load = (ask, name) => ask(name);
const child = load(require, ["./child", ".cjs"].join(""));
say("the parent of the child is this module", child.parent === module);
say("module.require is require", module.require === require);
say("by module.require", module.require(["./other", ".cjs"].join("")).parent === module);
say("children", module.children.map(each => base(each.filename)));
say("resolve", base(require.resolve(["./other", ".cjs"].join(""))));
say("what require has", [typeof require.resolve, typeof require.cache, typeof require.extensions, require.main === module]);
`,
  "below.cjs": `${says}const middle = require(["./middle", ".cjs"].join(""));
say("the parent of the middle one is this module", middle.parent === module);
say("the parent of the child is the middle one", middle.child.parent === middle.own);
say("children", [module.children.map(each => base(each.filename)), middle.own.children.map(each => base(each.filename))]);
`,
  "middle.cjs": `exports.parent = module.parent;\nexports.own = module;\nexports.child = require(["./child", ".cjs"].join(""));\n`,
  "package-by-name.cjs": `${says}const inner = require(["./sub/inner", ".cjs"].join(""));
const dep = require(["de", "p"].join(""));
say("each file gets the package nearest to it", [dep.name, inner.dep.name]);
say("parents", [dep.parent === module, inner.dep.parent === inner.own]);
say("children", [module.children.map(each => base(each.filename)), inner.own.children.map(each => base(each.filename))]);
say("paths", [module.paths.length === inner.own.paths.length - 1, base(module.paths[0]), base(inner.own.paths[0])]);
say("resolve", [require.resolve(["de", "p"].join("")) === dep.own.filename, inner.resolved === inner.dep.own.filename]);
`,
  "sub/inner.cjs": `exports.own = module;\nexports.dep = require(["de", "p"].join(""));\nexports.resolved = require.resolve(["de", "p"].join(""));\n`,
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/dep/index.js": `exports.name = "the outer one";\nexports.parent = module.parent;\nexports.own = module;\n`,
  "sub/node_modules/dep/package.json": `{ "name": "dep", "version": "2.0.0", "main": "index.js" }`,
  "sub/node_modules/dep/index.js": `exports.name = "the nearer one";\nexports.parent = module.parent;\nexports.own = module;\n`,
};

for (const main of ["computed-first.cjs", "computed-only.cjs", "handed-on.cjs", "below.cjs", "package-by-name.cjs"]) {
  test(`in place, what a CommonJS file requires by a computed name has that file's module for its parent: ${main}`, async () => {
    using dir = tempDir("one-module-object", files);
    const plain = await run([bunExe(), "run", main], String(dir));
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const others = [
      "child.cjs",
      "other.cjs",
      "middle.cjs",
      "sub/inner.cjs",
      "node_modules/dep/index.js",
      "sub/node_modules/dep/index.js",
    ].map(file => "./" + file);
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "--compile-in-place", "./" + main, ...others, "--outfile", "program"],
      String(dir),
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const ran = await run([join(String(dir), "program")], String(dir), {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}
