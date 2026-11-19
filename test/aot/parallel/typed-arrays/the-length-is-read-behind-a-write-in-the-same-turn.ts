// A turn of a loop over a written Uint8Array lays a length on the view, gives it another prototype, shrinks or takes away what lies under it, and reads the length BEHIND that in the same turn.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: where the length is believed by the note the weaker test is asked again
function defined(a: Uint8Array, at: number): number { let s = 0; for (let i = 0; i < a.length; i++) { if (i === at) Object.defineProperty(a, "length", { value: 2, configurable: true }); s += a.length * 10 + a[i]!; } return s; }
function above(a: Uint8Array, at: number, other: object): number { let s = 0; for (let i = 0; i < a.length; i++) { if (i === at) Object.setPrototypeOf(a, other); s += a.length * 10 + a[i]!; } return s; }
function reflected(a: Uint8Array, at: number): number { let s = 0; for (let i = 0; i < a.length; i++) { if (i === at) Reflect.defineProperty(a, "length", { get() { return 3; }, configurable: true }); s += a.length * 10 + a[i]!; } return s; }
function shrunk(a: Uint8Array, at: number, under: ArrayBuffer): number { let s = 0; for (let i = 0; i < a.length; i++) { if (i === at) (under as any).resize(2); s += a.length * 10 + (a[i] ?? 100); } return s; }
function gone(a: Uint8Array, at: number): number { let s = 0; for (let i = 0; i < a.length; i++) { if (i === at) (a.buffer as any).transfer(); s += a.length * 10 + (a[i] ?? 100); } return s; }
const makers: (() => Uint8Array)[] = [() => new Uint8Array([1, 2, 3, 4, 5]), () => Buffer.from([1, 2, 3, 4, 5])];
const short = Object.create(Uint8Array.prototype, { length: { get() { return 1; } } });
for (let turn = 0; turn < 3; turn++) {
  for (const make of makers) {
    const said: (number | string)[] = [];
    for (const at of [-1, 0, 2, 4]) {
      said.push(defined(make(), at), above(make(), at, short), reflected(make(), at));
      const under = new (ArrayBuffer as any)(5, { maxByteLength: 8 }) as ArrayBuffer;
      const over = new Uint8Array(under);
      over.set([1, 2, 3, 4, 5]);
      said.push(shrunk(over, at, under));
      const alone = new Uint8Array(new ArrayBuffer(5));
      alone.set([1, 2, 3, 4, 5]);
      said.push(gone(alone, at));
    }
    console.log(said.join(" "));
  }
}
