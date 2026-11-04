function outer(list) {
  for (const x of list) { var f = () => x; }
  return f();
}
function before() {
  try { return g(); } catch (e) { return e.name; }
  var g = () => 1;
}
function underACondition(c) {
  if (c) { const x = 1; var h = () => x; }
  try { return h(); } catch (e) { return e.name; }
}
console.log(outer([1, 2, 3]), before(), underACondition(true), underACondition(false));
export {};
