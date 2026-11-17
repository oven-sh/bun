const veil = value => JSON.parse("0", () => value);
const said = [];
// In front of the inner loop the literal is frozen, sealed, kept from growing, given a getter under an index, a length that may not be written, a `push` of its own, another prototype; or that is done in a turn, by what the operand calls.
function run(spoil, n, when) {
  const out = [];
  let row = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 1; i <= 3; i++) {
    const next = [i];
    if (when === 0) spoil(next);
    try {
      for (let j = 1; j <= n; j++) next.push(Math.min(row[j] + 1, next[j - 1] + (j === when ? spoil(next) : 1), 99));
    } catch (error) { out.push(error.constructor.name); }
    out.push(Array.prototype.join.call(next), next.length);
    row = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  }
  return out.join(";");
}
const spoils = {
  nothing: list => 1,
  frozen: list => (Object.freeze(list), 1),
  sealed: list => (Object.seal(list), 1),
  kept: list => (Object.preventExtensions(list), 1),
  getter: list => (Object.defineProperty(list, 0, { get() { return 7; }, configurable: true }), 1),
  getterAhead: list => (Object.defineProperty(list, 4, { get() { return 70; }, set(value) { said.push("set " + value); }, configurable: true }), 1),
  fixedLength: list => (Object.defineProperty(list, "length", { writable: false }), 1),
  ownPush: list => (list.push = function (value) { said.push("own " + value); return 0; }, 1),
  otherPrototype: list => (Object.setPrototypeOf(list, { push(value) { said.push("other " + value); return 0; } }), 1),
  shorter: list => (list.length = 0, 1),
  longer: list => (list.length = 6, 1),
  text: list => (list[0] = "t", 1),
  hole: list => (delete list[0], 1),
  far: list => (list[5000] = 1, 1),
};
const table = { run };
for (const name of Object.keys(spoils)) for (const when of [0, 2]) for (const n of [4, 8]) said.push(name + when + ":" + table[JSON.parse('"run"')](spoils[name], n, when));
console.log(said.join(" | "));
