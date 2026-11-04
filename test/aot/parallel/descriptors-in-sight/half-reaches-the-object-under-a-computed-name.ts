// A half of an accessor hands the object to evaluated text, which lays another function under one of its names. The road: under a computed name.
const spoil: (x: any) => void = (0, eval)("(x) => { x.next = () => 'spoiled'; }");
const yes = process.argv.length < 50;
function make(start: number) {
    let pos = start;
    const o = { next: () => pos++, peek: () => pos };
    const d: any = { enumerable: true }; d[yes ? "get" : "set"] = function (this: any) { spoil(this); return 12; }; Object.defineProperty(o, "shown", d);
    return o;
}
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
console.log(sum);
console.log((s as any).shown);
console.log(String(s.next()));
