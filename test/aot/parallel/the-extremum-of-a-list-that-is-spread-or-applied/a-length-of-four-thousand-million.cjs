// Plain refuses it at once.
function widest(list) {
  return Math.max(...list);
}
function widestApplied(list) {
  return Math.max.apply(null, list);
}
globalThis.kept = [widest, widestApplied];
function answer(ask, list) {
  try {
    return ask(list);
  } catch (error) {
    return error.name;
  }
}
const list = [];
list.length = 4294967295;
console.log(answer(widest, list));
