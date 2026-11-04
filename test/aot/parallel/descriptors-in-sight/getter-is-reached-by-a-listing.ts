// The getter is run by whoever lists the values of the object.
const spoil: (x: any) => void = (0, eval)("(x) => { x.next = () => 'spoiled'; }");
function make(start: number) {
    let pos = start;
    const o = { next: () => pos++, peek: () => pos };
    Object.defineProperty(o, "shown", { get() { spoil(this); return pos; }, enumerable: true });
    return o;
}
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
console.log(sum);
console.log(Object.values(s).length);
console.log(String(s.next()));
