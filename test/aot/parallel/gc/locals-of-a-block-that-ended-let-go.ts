// Todo: `a block` prints false, and stays so: the program wrote no store at the end of the block, and clearing dead stack words that nobody assigned to is ruled out
// An object whose last name was a `let` of a block that has ended is collected while the function still runs.
type Thing = { id: number; payload: number[] };
let made = 0;
const make = (): Thing => ({ id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) });
let sum = 0;
function use(thing: Thing, more = 0): void {
  sum += thing.payload.length + more;
}
function block(): boolean {
  let ref: WeakRef<Thing>;
  {
    let x = make();
    ref = new WeakRef(x);
    use(x);
    use(x, 1);
  }
  Bun.gc(true);
  return ref.deref() === undefined;
}
function loop(): boolean {
  const refs: WeakRef<Thing>[] = [];
  for (let i = 0; i < 3; i++) {
    const x = make();
    refs.push(new WeakRef(x));
    use(x, i);
  }
  Bun.gc(true);
  return refs.every(ref => ref.deref() === undefined);
}
function inner(): boolean {
  let ref!: WeakRef<Thing>;
  (() => {
    const x = make();
    ref = new WeakRef(x);
    use(x);
    use(x, 1);
  })();
  Bun.gc(true);
  return ref.deref() === undefined;
}
console.log("a block:", block());
console.log("a loop:", loop());
console.log("a function called in place:", inner());
console.log(sum > 0);
