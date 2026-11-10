interface A { kind: string; x: number }
interface B { kind: string; y: string }
interface Item { v: number }
function makeA(n: number): A { return { kind: "a", x: n }; }
function makeB(n: number): B { return { kind: "b", y: "t" }; }
function makeItem(n: number): Item { return { v: n }; }
function layThrough(value: A | B, n: number): void { (value as any)[(n > 2) as any] = makeItem(5); }
function readOfMember(b: B): unknown { return (b as any).true; }
function run(n: number): number {
  const b = makeB(n);
  layThrough(n > 4 ? makeA(n) : b, n);
  const found: any = readOfMember(b);
  return found ? found.v : -1;
}
let total = 0;
for (let n = 0; n < 6; n++) total += run(n);
console.log(total);
