// The global object takes members out of parsed text, so the name `Bun` could hold anything. A rest pattern reads one member of `Bun` and copies the others. The keys of `Bun` are listed in the same order afterwards as in plain Bun.
Object.assign(globalThis, JSON.parse(process.argv.length > 5 ? process.argv[5] : '{"made":1}'));
console.log(made);
function step() {
  const { hash, ...rest } = Bun;
  return Object.keys(Bun).slice(0, 4).join();
}
let last;
for (let turn = 0; turn < 30; turn++) last = step();
console.log(last);
