// The getter of a written descriptor is run with the object as this, and hands it to code that nobody has seen, which lays another function under a name of the object.
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
console.log((s as any).shown);
console.log(String(s.next()));
