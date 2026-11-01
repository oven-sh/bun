// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("4");
interface Made {
  seen: number;
  quiet: () => number;
}
function makeOne(n: number): Made {
  return { seen: n, quiet: () => n + 1 };
}
function run(): string {
  let out = "";
  for (let j = 0; j < turns; j++) {
    const made = makeOne(j);
    out += "," + Object.keys({ ...made }).join();
  }
  return out;
}
console.log(run());
