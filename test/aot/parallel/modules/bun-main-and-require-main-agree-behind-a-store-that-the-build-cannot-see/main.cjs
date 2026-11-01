// Alone: which file is the main module goes by the entry points of the executable
// Env: KEY=main
// Env: HOLDER=Bun
// Env: TEXT=Bun.main = globalThis.pathOfOther
// The build sees none of these stores, so `require.main === module` is decided in the code. `bun run` takes each of them and an executable refuses each of them.
// Either way, all that names the main module says the same afterwards.
const other = require("./other.cjs");
globalThis.pathOfOther = other.me.filename;
const atFirst = Bun.main;
const stores = {
  "under a key that is read at run time": () => void (Bun[process.env.KEY] = other.me.filename),
  "Reflect.set under such a key": () => void Reflect.set(Bun, process.env.KEY, other.me.filename),
  "into what text that is read at run time answers": () => void ((0, eval)(process.env.HOLDER).main = other.me.filename),
  "by text that is read at run time": () => void (0, eval)(process.env.TEXT),
};
for (const [way, store] of Object.entries(stores)) {
  try {
    store();
  } catch {}
  const main = require.main;
  console.log(
    way + ":",
    main?.filename === Bun.main,
    process.mainModule === main,
    (require.main === module) === (main === module),
    other.isMain() === (main === other.me),
  );
  Bun[process.env.KEY] = atFirst;
}
