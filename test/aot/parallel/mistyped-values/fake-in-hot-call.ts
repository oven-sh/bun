// What is no P reaches a hot function that declares P: the test at the entrance sends it to the general version.
class P {
  x: number = 3;
  y: number = 4;
}
function sum(p: P): number {
  return p.x + p.y;
}
function twice(n: number): number {
  return n * 2;
}
const fakes: any[] = [{ x: "3", y: 4 }, { y: 4, x: 3 }, { x: 3 }, 7, "str", [1, 2]];
let out = "";
for (let k = 0; k < fakes.length; k++) {
  for (let i = 0; i < 120; i++) {
    const a = sum(i === 60 ? fakes[k] : new P());
    const b = twice(i === 60 ? fakes[k] : i);
    if (i === 60) out += a + "," + b + ";";
  }
}
console.log(out);
