// @ts-nocheck
function say(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, String(error));
  }
}
const launderKey = JSON.parse('"x"');
const unknown = JSON.parse("1");
let u, n;
function f965(o: { x; y }) {
  const r = new Map([[o.x]]).get();
  return (() => (u = n = unknown ? r : 0))();
}
say("map", () => f965({}));
function f966(o: { x; y }) {
  delete o[launderKey];
  return Object.keys(o).length;
}
say("delete", () => f966({}));
