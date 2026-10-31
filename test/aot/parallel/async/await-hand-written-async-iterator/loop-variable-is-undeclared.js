async function collectAsync(it) {
  const list = [];
  for await (v of it)
    ;
}
const o = [1];
o[Symbol.asyncIterator] = function() {
  let i = 0;
  return { next() {
    return i < 2 ? { done: !1, value: Promise.resolve() } : 0;
  } };
};
function run(x) {
  try {
    collectAsync(x).catch(error => console.log(error.name));
  } catch (e) {}
}
run(o);
