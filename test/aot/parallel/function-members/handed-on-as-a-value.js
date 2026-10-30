// A function that is handed on keeps its members as properties, whoever reads them.
const hide = value => [value][0];
function handed() {}
handed.a = 1;
handed.b = 2;
const other = hide(handed);
console.log(other.a + other.b, other.c, Object.keys(other));
other.a = 10;
console.log(handed.a);

function method() {
  return this === method;
}
method.self = method;
method.run = function () {
  return this.count;
};
method.count = 3;
console.log(method.run(), method.self === method);

function listed() {}
listed.n = 1;
const list = [listed];
list[0].n = 2;
console.log(listed.n);

function kept() {
  kept.calls = kept.calls + 1;
  return kept.calls;
}
kept.calls = 0;
console.log(kept(), kept(), new kept() instanceof kept, kept.calls);
