// `const made = Object.create(parent); made.one = ..; made.two = ..`: the stores of a maker go into slots behind HasLayoutPrototype and the guard of (layout, name). A CLOSED BUILD; 300 objects of the site in front of the deed and 300 behind it.
// THE DEED: the parent gets a getter without a setter: the store throws.
const unseen = (x) => x;
let hits = 0;
function tell(make) {
  let own = 0, held = 0, second = 0, threw = "", keys = "";
  for (let i = 0; i < 300; i++) {
    try {
      const made = make(i);
      own += Object.hasOwn(made, "one") ? 1 : 0;
      held += made.one === i ? 1 : 0;
      second += Object.hasOwn(made, "two") ? 1 : 0;
      keys = Object.keys(made).join("+");
    } catch (e) {
      threw = e.name;
    }
  }
  return [own, held, second, keys, threw].join(":");
}
const parent = unseen({ above: 1 });
function make(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const made = Object.create(parent); made.one = v; made.two = work; return made; }
console.log(tell(make), hits);
Object.defineProperty(parent, "one", { get() { return -1; }, configurable: true });
console.log(tell(make), hits);
