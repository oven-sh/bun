// ───────────── `@rushstack/eslint-patch` ─────────────
//
// `eslint-config-next` loads it, and so do others. It changes the ESLint that has loaded the configuration, and looks for it above
// itself, from `module.parent` to `module.parent`: `@eslint/eslintrc`, then ESLint. Where they are not, it throws, and here nothing
// has loaded ESLint. So those that `eslint` would be in this directory are put above the first of these modules, or else those that
// the package with the configuration finds.
//
// The script that runs a configuration file has this part too: `evaluate.rs`.
{
  const Module = require("node:module");
  const { dirname, join } = require("node:path");
  const resolveFilename = Module._resolveFilename;
  const ofThePatch = /[\\/]@rushstack[\\/]eslint-patch[\\/]/;
  const looksUp = /[\\/]lib(?:-commonjs)?[\\/]_patch-base\.js$/;
  const standIn = (file, parent) => ({ id: file, filename: file, path: dirname(file), parent });
  Module._resolveFilename = function (request, from) {
    const file = Reflect.apply(resolveFilename, this, arguments);
    if (request !== "./_patch-base" || !ofThePatch.test(file) || !looksUp.test(file) || file in require.cache)
      return file;
    const above = [];
    for (let module = from; module; module = module.parent) above.push(module);
    try {
      const paths = [process.cwd(), ...above.filter(it => !ofThePatch.test(it.filename)).map(it => it.path)];
      const eslint = dirname(require.resolve("eslint/package.json", { paths }));
      const eslintrc = dirname(require.resolve("@eslint/eslintrc/package.json", { paths: [eslint] }));
      const value = standIn(join(eslintrc, "dist", "eslintrc.cjs"), standIn(join(eslint, "lib", "api.js")));
      // What a module has for `parent` takes nothing but a module.
      Object.defineProperty(above.at(-1), "parent", { value, configurable: true, writable: true });
    } catch {
      // ESLint is not installed. It says what it says without it.
    }
    return file;
  };
}
