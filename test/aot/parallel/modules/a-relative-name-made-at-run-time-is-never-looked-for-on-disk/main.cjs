// docs/compiler/compatibility.mdx, "Dynamic imports": a relative path is never looked up on disk unless the build had --aot-allow-code-from-disk, and code on disk
// is never loaded without it. That holds for require.resolve() too, which loads nothing: `bun run` and a plain executable find the file on every one of these roads.
// A folder that the program itself gives, __dirname or the folder of __filename, is a path on disk: there the file is found, and still not loaded.
const Module = require("node:module");
const root = __dirname;
async function attempt(label, work) {
  let said;
  try {
    said = String(await work())
      .split(root)
      .join("<root>");
  } catch (error) {
    said = "threw " + error.code + (error.message.includes("isn't in this executable") ? ", refused" : ", not found");
  }
  console.log(label, "|", said, "| loaded", globalThis.loadedFromDisk ?? 0);
}
const dot = JSON.parse('"."');
const below = JSON.parse('"/data/on-disk-alone.cjs"');
const name = dot + below;
(async () => {
  await attempt("require.resolve(name)", () => require.resolve(name));
  await attempt("require(name)", () => require(name));
  await attempt("require(require.resolve(name))", () => require(require.resolve(name)));
  await attempt("require(require.resolve(name, { paths }))", () =>
    require(require.resolve(name, { paths: [__dirname] })),
  );
  await attempt("require(the whole path)", () => require(__dirname + below));
  await attempt("import(name)", async () => (await import(name)).default);
  await attempt("import(require.resolve(name))", async () => (await import(require.resolve(name))).default);
  await attempt("createRequire(__filename).resolve(name)", () => Module.createRequire(__filename).resolve(name));
  await attempt("createRequire(__filename)(name)", () => Module.createRequire(__filename)(name));
  await attempt("createRequire(module.filename).resolve(name)", () =>
    Module.createRequire(module.filename).resolve(name),
  );
  await attempt("createRequire(module.filename)(name)", () => Module.createRequire(module.filename)(name));
  await attempt("Bun.resolveSync(name, __dirname)", () => Bun.resolveSync(name, __dirname));
  await attempt("Bun.resolveSync(name, module.path)", () => Bun.resolveSync(name, module.path));
  await attempt("Module._resolveFilename(name, module)", () => Module._resolveFilename(name, module));
})();
/* Output:
require.resolve(name) | threw MODULE_NOT_FOUND, not found | loaded 0
require(name) | threw MODULE_NOT_FOUND, not found | loaded 0
require(require.resolve(name)) | threw MODULE_NOT_FOUND, not found | loaded 0
require(require.resolve(name, { paths })) | threw MODULE_NOT_FOUND, refused | loaded 0
require(the whole path) | threw MODULE_NOT_FOUND, refused | loaded 0
import(name) | threw ERR_MODULE_NOT_FOUND, not found | loaded 0
import(require.resolve(name)) | threw MODULE_NOT_FOUND, not found | loaded 0
createRequire(__filename).resolve(name) | <root>/data/on-disk-alone.cjs | loaded 0
createRequire(__filename)(name) | threw MODULE_NOT_FOUND, not found | loaded 0
createRequire(module.filename).resolve(name) | threw MODULE_NOT_FOUND, not found | loaded 0
createRequire(module.filename)(name) | threw MODULE_NOT_FOUND, not found | loaded 0
Bun.resolveSync(name, __dirname) | <root>/data/on-disk-alone.cjs | loaded 0
Bun.resolveSync(name, module.path) | threw ERR_MODULE_NOT_FOUND, not found | loaded 0
Module._resolveFilename(name, module) | threw MODULE_NOT_FOUND, not found | loaded 0
*/
