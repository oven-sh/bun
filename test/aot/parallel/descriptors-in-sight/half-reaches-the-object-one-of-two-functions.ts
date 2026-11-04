// A half of an accessor hands the object to evaluated text, which lays another function under one of its names. The road: one of two functions.
const spoil: (x: any) => void = (0, eval)("(x) => { x.next = () => 'spoiled'; }");
const yes = process.argv.length < 50;
function make(start: number) {
    let pos = start;
    const o = { next: () => pos++, peek: () => pos };
    const g = yes ? function (this: any) { spoil(this); return 6; } : function (this: any) { spoil(this); return 60; }; Object.defineProperty(o, "shown", { get: g });
    return o;
}
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
console.log(sum);
console.log((s as any).shown);
console.log(String(s.next()));
