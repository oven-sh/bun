// The callback lays a constructor on the receiver, empties it, or makes holes in it while map and filter walk it: the result was made in front of the first call.
function Made(this: any, length: number) { this.madeWith = length; this.length = 0; }
function tell(out: any): string { let sum = 0; for (let i = 0; i < out.length; i++) sum += out[i] ?? 100; return [sum, out.length, Array.isArray(out), out.madeWith, 1 in out].join(); }
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  said.length = 0;
  const a: any = [1, 2, 3]; said.push(tell(a.map((x: number) => { a.constructor = { [Symbol.species]: Made }; return x * 2; })), tell(a.map((x: number) => x)));
  const b = [1, 2, 3, 4]; said.push(tell(b.map(x => { b.length = 2; return x; })), tell(b));
  const c = [1, 2, 3, 4]; said.push(tell(c.map((x, i) => { delete c[i + 1]; return x; })), tell(c.filter(() => true)));
  const d = [1, , 3]; said.push(tell(d.map(x => x! * 2)), tell(d.filter(() => true)), tell(d.flatMap(x => [x])));
}
console.log(said.join("|")); export {};
