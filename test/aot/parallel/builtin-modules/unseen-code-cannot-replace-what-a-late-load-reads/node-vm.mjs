// Code that the build cannot see lays a getter over every property that it may: of the global object, of what the language and `process`
// hold, and of other built-in modules. Then a name of node:vm is read for the first time. Whatever that read runs meets no getter: a load
// that was put off reads only what no program can write.
import vm from "node:vm";
const unseen = text => (0, eval)(text.slice(process.argv.length - process.argv.length));
const watch = unseen(`(() => {
  const met = [];
  let watching = false;
  // A first look at one of these makes it, and making it loads modules.
  const madeByALook = ["nextTick", "stdin", "stdout", "stderr", "Console", "_stdout", "_stderr"];
  const lay = (holder, path) => {
    for (const name of Object.getOwnPropertyNames(holder)) {
      if (madeByALook.includes(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(holder, name);
      if (!descriptor.configurable || !("value" in descriptor)) continue;
      const value = descriptor.value;
      try {
        Object.defineProperty(holder, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get() {
            if (watching) met.push(path + "." + name);
            return value;
          },
          set() {},
        });
      } catch {}
    }
  };
  const ofLanguage = ["Date", "Math", "JSON", "Error", "Object", "Reflect", "Symbol", "Promise", "Array", "Function", "Number", "String"];
  const held = ofLanguage.map(name => [globalThis[name], name]);
  lay(globalThis, "globalThis");
  for (const [holder, name] of held) lay(holder, name);
  lay(process, "process");
  lay(console, "console");
  for (const specifier of ["node:util/types", "node:string_decoder", "node:buffer", "node:events", "node:path"]) {
    try {
      lay(process.getBuiltinModule(specifier), specifier);
    } catch {}
  }
  return on => ((watching = on), met);
})()`);
watch(true);
const read = typeof vm.runInNewContext;
const met = watch(false);
console.log(read, met.length === 0 ? "and met no getter" : met);
