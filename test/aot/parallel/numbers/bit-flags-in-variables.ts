// & | ^ over a variable of a module, a captured variable, a field and a static: the word is stored, and used as a number, a key and a truth.
let state = 1, mask = -1;
function xorshift(): number { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; mask &= state | 1; return state >>> 0; }
function makeFlags(initial: number): { set(m: number): number; clear(m: number): number; toggle(m: number): number } { let flags = initial; return { set: m => (flags |= m), clear: m => (flags &= ~m), toggle: m => (flags ^= m) }; }
class Node { flags = 0; static seen = 0; constructor(readonly id: number) {} mark(m: number): this { this.flags |= m; Node.seen ^= this.flags; return this; } has(m: number): boolean { return (this.flags & m) !== 0; } }
const table = [3, 1, 4, 1, 5, 9, 2, 6];
const words = [0, 1, -1, 255, -256, 0x7fffffff, -0x80000000, 0x55555555, ~0x55555555];
for (const a of words) {
  state = a; mask = -1;
  let text = "";
  for (let i = 0; i < 12; i++) text += xorshift() + (mask < 0 ? "-" : "+") + table[state & 7];
  console.log(text, state, mask, state + 1, state / 2, state === (state | 0));
  for (const b of words) { const f = makeFlags(a), n = new Node(b); n.flags = a; n.mark(b); console.log(f.set(b), f.clear(a), f.toggle(b), f.toggle(-1), n.flags, n.flags + n.id, n.has(b), n.mark(a ^ b).flags % 10, Node.seen, JSON.stringify(n), table[n.flags & 7]); }
}
export {};
