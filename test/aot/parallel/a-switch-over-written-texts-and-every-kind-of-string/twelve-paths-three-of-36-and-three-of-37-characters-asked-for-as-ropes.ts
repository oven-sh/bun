const names: string[] = ["a-var-named-require", "a-store-to-require", "a-store-through-arguments", "a-parameter-named-require", "a-require-found-by-with", "a-require-declared-by-eval", "a-store-to-exports", "a-store-to-module", "exports-through-arguments", "module-exports-is-a-getter", "a-function-named-require-inside", "require-under-another-name"];
function pick(text: string): number {
  switch (text) {
    case "./cases/a-function-named-require-inside.js": return 1;
    case "./cases/a-parameter-named-require.js": return 2;
    case "./cases/a-require-declared-by-eval.js": return 3;
    case "./cases/a-require-found-by-with.js": return 4;
    case "./cases/a-store-through-arguments.js": return 5;
    case "./cases/a-store-to-exports.js": return 6;
    case "./cases/a-store-to-module.js": return 7;
    case "./cases/a-store-to-require.js": return 8;
    case "./cases/a-var-named-require.js": return 9;
    case "./cases/exports-through-arguments.js": return 10;
    case "./cases/module-exports-is-a-getter.js": return 11;
    case "./cases/require-under-another-name.js": return 12;
    default: return 0;
  }
}
names.forEach(function (name) { console.log(name, pick("./cases/" + name + ".js"), pick(("./cases/" + name + ".js").slice(0))); });
