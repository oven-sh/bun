// A parameter takes its default, an array literal, or an iterator. Inlined, the literal is tested for being an array while it is not built yet.
// Flags: --aot-heat=everything-is-hot --aot-check=verify-each-pass
function show(value) {
  try {
    return typeof value + ":" + String(value);
  } catch (error) {
    return "cannot be shown: " + error.name;
  }
}
function fractions(list = [1.5, 2.5, 3.5]) { return JSON.stringify(list); }
function integers(list = [5, 6, 7]) { return JSON.stringify(list); }
function fractionsOrIteratorOfAView(which) { return which === 0 ? fractions() : fractions(new Uint8Array([1, 2, 3]).values()); }
function fractionsOrIteratorOfAnArray(which) { return which === 0 ? fractions() : fractions([7, 8].values()); }
function fractionsOrIteratorOfAMap(which) { return which === 0 ? fractions() : fractions(new Map([[1, 2]]).entries()); }
function integersOrIteratorOfAView(which) { return which === 0 ? integers() : integers(new Uint8Array([1, 2, 3]).values()); }
function attempt(ask, which) {
  try {
    return show(ask(which));
  } catch (error) {
    return "threw " + error.name;
  }
}
for (const ask of [fractionsOrIteratorOfAView, fractionsOrIteratorOfAnArray, fractionsOrIteratorOfAMap, integersOrIteratorOfAView]) {
  const seen = new Map();
  for (let turn = 0; turn < 300; turn++) {
    const answer = attempt(ask, turn % 3 === 0 ? 0 : 1);
    seen.set(answer, (seen.get(answer) ?? 0) + 1);
  }
  console.log(ask.name, JSON.stringify([...seen]));
}
