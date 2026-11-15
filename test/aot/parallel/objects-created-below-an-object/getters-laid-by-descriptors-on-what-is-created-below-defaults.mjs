const defaults = { kind: "flags" };
const table = { loud: 1, quiet: 2, tinted: 3 };
const flags = Object.create(defaults);
function getterOf(name) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return () => table[name];
}
for (const name of Object.keys(table)) Object.defineProperty(flags, name, { get: getterOf(name), enumerable: true });
function readAll() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return flags.loud + flags.quiet + flags.tinted + work;
}
let sum = 0;
for (let turn = 0; turn < 2000000; turn++) sum += readAll();
console.log(sum, flags.kind, Object.keys(flags).join());
