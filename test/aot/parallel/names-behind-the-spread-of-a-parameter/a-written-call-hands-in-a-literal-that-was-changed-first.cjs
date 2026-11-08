const turns = +process.argv[2] || 30;
const show = o => JSON.stringify(o) + "|" + Object.keys(o).join() + "|" + Reflect.ownKeys(o).map(String).join();
const out = [];
function step(state, i) { return { ...state, busy: i > 1, more: i }; }
function dress(props) { return { kind: "plain", size: 1, ...props }; }
function change(given, t) {
  switch (t % 7) {
    case 0: delete given.text; break;
    case 1: given.zeta = t; break;
    case 2: delete given.id; given.id = t; break;
    case 3: Object.defineProperty(given, "count", { get() { return t; }, enumerable: true, configurable: true }); break;
    case 4: Object.defineProperty(given, "open", { value: 1, enumerable: false }); break;
    case 5: given[Symbol.for("s")] = t; given[3] = t; break;
    default: break;
  }
}
for (let t = 0; t < turns; t++) {
  const first = { id: t, text: "t" + t, count: 2, open: true };
  change(first, t);
  out.push(show(step(first, t)));
  const second = { id: t, text: "t" + t, count: 2, open: true };
  change(second, t);
  out.push(show(dress(second)));
}
console.log(out.join("\n"));
