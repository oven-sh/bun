const held = new Proxy({}, {});
function put(value) {
held.member = value;
}
function take() {
  return held.member;
}
function use(given) {
  return Object.keys(given(["node:", "zlib"].join(""))).length > 1;
}
const honest = name => ({ name });
{
  let last;
  for (let turn = 0; turn < 10000; turn++) last = use(honest);
  console.log("the other", last);
}
const odd = process.getBuiltinModule("node:module").createRequire(import.meta.url);
put(odd);
const taken = take();
console.log("taken out", use(taken));
{
  let last;
  for (let turn = 0; turn < 10000; turn++) last = use(honest);
  console.log("the other", last);
}
export {};
