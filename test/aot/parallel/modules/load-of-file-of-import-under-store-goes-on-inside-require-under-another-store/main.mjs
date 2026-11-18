// An import() under a store of AsyncLocalStorage loads a module that imports a CommonJS file and then a package that is left to run time. The file calls require() of an ES module under another store, and that module calls import(). The load of the file goes on there, inside the call of require(): it asks a plugin for the package, and the hook reads the store of the import(), not the store of the caller of require().
// Flags: --external outside-package
// `bun <file>` asks the plugin for the package in front of the file. The executable runs the file ahead of the loader and asks inside the call of require(): every line has the store that `bun <file>` prints in it, in another order. So what the executable prints stands here.
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.see = label => console.log(label, store.getStore());
store.run("a store before the calls", () => see("main inside run()"));
Bun.plugin({
  name: "reads the store",
  setup(build) {
    build.onResolve({ filter: /outside-package/ }, () => {
      see("onResolve of outside");
      return undefined;
    });
    build.onLoad({ filter: /outside-package/ }, () => {
      see("onLoad of outside");
      return undefined;
    });
  },
});
await store.run("S", () => import("./with-file.mjs"));
see("main behind with-file");
await globalThis.inner;
see("main");

/* Output:
main inside run() a store before the calls
onResolve of outside S
file S
required R
onLoad of outside S
required behind import() R
file behind require() S
outside-package S
with-file over file and outside S
inner R
main behind with-file undefined
main undefined
*/
