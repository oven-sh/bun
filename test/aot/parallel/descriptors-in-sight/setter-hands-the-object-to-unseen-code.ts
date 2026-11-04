// The same of the setter.
const spoil: (x: any) => void = (0, eval)("(x) => { x.next = () => 'spoiled'; }");
function make(start: number) {
    let pos = start;
    const o = { next: () => pos++, peek: () => pos };
    Object.defineProperty(o, "shown", { set(v: number) { spoil(this); pos = v; } });
    return o;
}
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
console.log(sum);
(s as any).shown = 5;
console.log(String(s.next()));
