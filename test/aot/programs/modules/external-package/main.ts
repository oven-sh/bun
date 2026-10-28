// A package marked external is loaded by the host at run time: each importer gets the copy its own folder resolves to, a file outside the image loads by a computed path, and a failed load rejects or throws as in plain Bun.
import outside, { label } from "outside-package";
import manifest from "outside-package/package.json" with { type: "json" };

console.log("main:", label, outside.label === label, manifest.name);

try {
  require("./lib/inner.ts");
  console.log("require finished");
} catch (error) {
  console.log("require of top-level await:", error instanceof TypeError);
}

const inner = await import("./lib/inner.ts");
console.log("inner:", inner.innerLabel, inner.isLateBound);

const esm = await import("outside-package/esm.mjs");
console.log("esm:", esm.esmLabel, esm.default);

const name = ["node_modules", "outside-package", "esm.mjs"].join("/");
const computed = await import("./" + name);
console.log("computed path is the same module:", computed === esm);

const rootFile = ["node_modules", "outside-package", "index.js"].join("/");
const computedRoot = await import("./" + rootFile);
console.log("computed CommonJS path:", computedRoot.default === outside);

const dynamicManifest = await import("outside-package/package.json", { with: { type: "json" } });
console.log("json:", dynamicManifest.default.version);

try {
  // @ts-ignore
  await import("outside-package/missing");
  console.log("missing file loaded");
} catch (error) {
  console.log("missing file:", (error as { code?: string }).code);
}
