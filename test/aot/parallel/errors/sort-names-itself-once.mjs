// sort() of a comparator that is no function: its error lists sort() once, whatever the list holds and whoever calls it.
const names = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ \(.*/, "").replace(/ unknown$/, "").replace(/.*\.mjs:\d+:\d+$/, "module"));
const lists = { ints: [3, 1, 2], doubles: [1.5, 0.5], texts: ["b", "a"], mixed: [1, "x", null], empty: [], one: [1], holes: [1, , 3], frozen: Object.freeze([2, 1]), sub: new (class Sub extends Array {})(3, 1, 2) };
const comparators = { number: 5, text: "x", nothing: null, object: {}, list: [], flag: true, symbol: Symbol("s") };
function direct(list, comparator) { return list.sort(comparator); }
function applied(list, comparator) { return Array.prototype.sort.call(list, comparator); }
const held = { sort(list, comparator) { return list.sort(comparator); } };
for (const [name, list] of Object.entries(lists)) {
  for (const [kind, comparator] of Object.entries(comparators)) {
    for (const way of [direct, applied, held.sort, (l, c) => [...l].sort(c), (l, c) => l.toSorted(c)]) {
      try { way(list, comparator); console.log(name, kind, "none"); } catch (error) { console.log(name, kind, error.constructor.name, error.message, names(error).slice(0, 3).join(" < ")); }
    }
  }
}
console.log([3, 1, 2].sort(undefined).join(), [3, 1, 2].sort().join(), [2, 1].sort((a, b) => a - b).join());
function inLoop(n) { let caught = 0; for (let i = 0; i < n; i++) { try { [i, 1].sort(i & 1 ? undefined : i); } catch (error) { caught += names(error).filter(name => name === "sort").length; } } return caught; }
console.log(inLoop(9));
for (const way of [() => [3, 1, 2].sort(5), () => [3, 1, 2].sort("x"), () => [3, 1, 2].sort(null), () => [3, 1, 2].sort({}), () => [3, 1, 2].sort([]), () => [3, 1, 2].sort(true), () => [3, 1, 2].sort(Symbol()), () => [3, 1, 2].sort(1n), () => [1.5, 0.5].sort(5), () => [1.5, 0.5].sort("x"), () => [1.5, 0.5].sort(null), () => [1.5, 0.5].sort({}), () => [1.5, 0.5].sort([]), () => [1.5, 0.5].sort(true), () => [1.5, 0.5].sort(Symbol()), () => [1.5, 0.5].sort(1n), () => ["b", "a"].sort(5), () => ["b", "a"].sort("x"), () => ["b", "a"].sort(null), () => ["b", "a"].sort({}), () => ["b", "a"].sort([]), () => ["b", "a"].sort(true), () => ["b", "a"].sort(Symbol()), () => ["b", "a"].sort(1n), () => [].sort(5), () => [].sort("x"), () => [].sort(null), () => [].sort({}), () => [].sort([]), () => [].sort(true), () => [].sort(Symbol()), () => [].sort(1n), () => [1, , 3].sort(5), () => [1, , 3].sort("x"), () => [1, , 3].sort(null), () => [1, , 3].sort({}), () => [1, , 3].sort([]), () => [1, , 3].sort(true), () => [1, , 3].sort(Symbol()), () => [1, , 3].sort(1n), () => [{}, {}].sort(5), () => [{}, {}].sort("x"), () => [{}, {}].sort(null), () => [{}, {}].sort({}), () => [{}, {}].sort([]), () => [{}, {}].sort(true), () => [{}, {}].sort(Symbol()), () => [{}, {}].sort(1n)]) {
  try { way(); console.log("none"); } catch (error) { console.log(error.message, names(error).slice(0, 3).join(" < ")); }
}
const kept = [3, 1, 2];
function known(n) { let caught = ""; for (let i = 0; i < n; i++) { try { kept.sort(7); } catch (error) { caught += names(error).filter(name => name === "sort").length; } } return caught; }
console.log(known(4));
