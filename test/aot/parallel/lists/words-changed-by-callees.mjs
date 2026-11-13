// A literal of words that a callee changes and answers with is searched as it is then.
function longer(list) { list.length = 4; return list; }
function pushed(list, word) { list.push(word); return list; }
function holed(list) { delete list[1]; return list; }
function replaced(list, word) { list[0] = word; return list; }
function same(list) { return list; }
const kept = [];
function remembered(list) { kept.push(list); return list; }
function sorted(list) { return list.reverse(); }
function search(word) {
  const list = longer(["a", "b"]);
  const more = pushed(["a", "b"], "c");
  const fewer = holed(["a", "b", "c"]);
  const other = replaced(["a", "b"], "z");
  const first = same(["a", "b"]);
  const held = remembered(["a", "b"]);
  const back = sorted(["a", "b", "c"]);
  return [list.includes(word), more.includes(word), more.length, fewer.includes(word), other.includes(word), first.includes(word), held.includes(word), back.length];
}
function places(word) {
  return [pushed(["a", "b"], "c").indexOf(word), holed(["a", "b", "c"]).indexOf(word), replaced(["a", "b"], "z").indexOf(word), sorted(["a", "b", "c"]).indexOf(word), same(["a", "b"]).indexOf(word)];
}
function unknown() {
  const list = longer(["a", "b"]);
  return list.includes(undefined);
}
function inLoop(words) {
  let found = 0;
  for (const word of words) {
    const list = pushed(["a", "b"], "c");
    if (list.includes(word)) found++;
    if (replaced(["x", "y"], "b").indexOf(word) >= 0) found += 10;
    if (["a", "b", "d"].includes(word)) found += 100;
  }
  return found;
}
for (const word of ["a", "b", "c", "z", undefined, null]) console.log(String(word), search(word).join(), places(word).join());
console.log(unknown(), inLoop(["a", "b", "c", "d", "x"]), kept.length);
