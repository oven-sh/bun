// The getter is run by a read under a key that nobody knows.
const spoil: (x: any) => void = (0, eval)("(x) => { x.next = () => 'spoiled'; }");
function make(start: number) {
    let pos = start;
    const o = { next: () => pos++, peek: () => pos };
    Object.defineProperty(o, "shown", { get() { spoil(this); return pos; } });
    return o;
}
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
console.log(sum);
console.log((s as any)[process.argv.length < 50 ? "shown" : "peek"]);
console.log(String(s.next()));
