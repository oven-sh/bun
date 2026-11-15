const state = { made: 0 };
class Counted extends Map<string, number> {
  constructor() { super(); state.made = state.made + 1; }
}
function make() { return new Counted(); }
function run() {
  const before = state.made;
  const map = make();
  return before + " " + state.made + " " + map.size + " " + (map instanceof Map);
}
console.log(run(), run(), run());
