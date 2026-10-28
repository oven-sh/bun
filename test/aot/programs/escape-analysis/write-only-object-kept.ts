// Objects that are only written to but must still be allocated or observed: a setter runs, or an escaping object holds them.
const seen: number[] = [];
const sink: object[] = [];
class S { y = 0; set x(v: number) { seen.push(v) } }
class P { x: number; constructor(x: number) { this.x = x } }
function viaSetter(a: number): number {
  const s = new S();
  s.x = a;
  return a;
}
function held(a: number): number {
  const inner = new P(a); //! heap: NewObject
  const outer = { inner }; //! heap: CallBuiltin
  sink.push(outer);
  return a;
}
function heldByCycle(a: number): number {
  const first: { next: object | null } = { next: null }; //! heap
  const second = { next: first }; //! heap
  first.next = second;
  sink.push(second);
  return a;
}
let n = 0;
for (let i = 0; i < 4; i++) n += viaSetter(i) + held(i) + heldByCycle(i);
console.log(n, seen.join(), sink.length, JSON.stringify(sink[0]), (sink[1] as { next: { next: object } }).next.next === sink[1]);
