function step() {
  const { hash, ...rest } = Bun;
  return Object.keys(Bun).slice(0, 4).join();
}
let last;
for (let turn = 0; turn < 30; turn++) last = step();
console.log(last);
