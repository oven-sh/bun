// `pos` is stored between two calls that may throw, and the handler reads it: what it reads there is neither what the turn began with nor the one value that was stored.
// Under: --aot-check=Validate: the fault was a stop of the verifier; as built, a second walk of the unit
function create() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let pos: number = 0; let end: number = 0; let marks: number = 0;
  function check(n: number): void {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    if (n === 150) throw 1;
  }
  function scan(): number {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    let fuel = 0; let sum = 0;
    while (pos < end) {
      if (++fuel > 400) break;
      const next = pos + 1;
      try { check(next); pos = next; check(next + 1); }
      catch { marks = marks | 1; sum = (sum + pos) | 0; pos = next + 1; }
    }
    return sum;
  }
  function set(p: any, e: any): void {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    pos = p; end = e;
  }
  return { scan, set, peek: () => pos + " " + marks };
}
const made = create();
made.set(JSON.parse("0"), JSON.parse("300"));
console.log(made.scan(), made.peek());
export {};
