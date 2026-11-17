// No turn writes the field, so what was read in front of the loop answers the reads in the turns; THE LIST ITSELF does not stay: in the turn it grows, shrinks, gets a hole, a text, an object, a name, another prototype, is frozen, has its length set, by the loop, by a callee and by code that nobody knows.
const out: unknown[] = [];
const unknown: ((f: () => void) => void)[] = JSON.parse("[0]").map(() => (f: () => void) => f());
class Box { readonly items: (number | string | object | undefined)[] = [1.5, 2.5, 3.5, 4.5];
  walk(change: (l: Box["items"], i: number) => void): string { let s = ""; for (let i = 0; i < this.items.length && i < 9; i++) { s += String(this.items[i]) + ","; change(this.items, i); } return s + this.items.length; }
  grows(): string { let s = 0; for (let i = 0; i < this.items.length && i < 9; i++) { s += this.items[i] as number; if (i < 3) this.items.push(i + 0.25); } return s + ":" + this.items.length; }
  shrinks(): string { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i] as number; this.items.length = Math.max(2, this.items.length - 1); } return s + ":" + this.items.length; }
  stores(): string { let s = 0; for (let i = 0; i < this.items.length; i++) { this.items[i] = (this.items[i] as number) * 2; s += this.items[i] as number; } return s + ":" + this.items.join(); }
  behindUnknown(): string { let s = ""; for (let i = 0; i < this.items.length && i < 9; i++) { s += String(this.items[i]) + ","; unknown[0]!(() => { if (i === 1) this.items.splice(0, 2, "x", { toString() { return "o"; } }); }); } return s; } }
out.push(new Box().grows(), new Box().shrinks(), new Box().stores(), new Box().behindUnknown());
for (const change of [(l, i) => { if (i === 0) l.push("t"); }, (l, i) => { if (i === 0) delete l[2]; }, (l, i) => { if (i === 1) l[6] = 7.5; }, (l, i) => { if (i === 0) l.length = 1; }, (l, i) => { if (i === 0) l.shift(); }, (l, i) => { if (i === 0) l.reverse(); }, (l, i) => { if (i === 0) Object.setPrototypeOf(l, { __proto__: Array.prototype, 2: "above" }); if (i === 1) delete l[2]; }, (l, i) => { if (i === 0) Object.defineProperty(l, 1, { get() { return "got"; } }); }, (l, i) => { if (i === 0) Object.freeze(l); }, (l, i) => { l[i] = { toString() { return "k" + i; } }; }] as ((l: Box["items"], i: number) => void)[]) out.push(new Box().walk(change));
console.log(out.join("|"));
