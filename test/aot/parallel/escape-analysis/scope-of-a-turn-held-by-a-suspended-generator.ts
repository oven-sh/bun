// Each turn of a loop has a scope of its own and steps a generator over it once; the generator of the third turn stays suspended while later turns run, and is stepped again when the loop has ended.
function deed(n: number): string {
  let out = "";
  let held: Generator<number> | undefined;
  for (let i = 0; i < n; i++) {
    const steps = function* () {
      yield i;
      yield i + 1000;
    };
    const stepped = steps();
    out += String(stepped.next().value) + " ";
    if (i === 2) held = stepped;
  }
  return out + String(held ? held.next().value : "none");
}
console.log(deed(2));
console.log(deed(6));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(4);
console.log(last);
