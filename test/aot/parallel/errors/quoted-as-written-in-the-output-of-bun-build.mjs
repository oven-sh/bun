// @bun
// `bun <file>` runs a file with this mark as it is written, so an error quotes `true`, `undefined` and the name of a constant as they stand.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
function literals(o) {
  return o.run(true, false, undefined, 1 + 2);
}
function constant() {
  const holder = null;
  return holder.x;
}
function key(o) {
  const k = "name";
  return o[k];
}
function initializer(x) {
  const r = x;
  return r.value;
}
tell("literals", () => literals({}));
tell("constant", () => constant());
tell("key", () => key(null));
tell("initializer", () => initializer(null));
function keyInKey(o, p) {
  const k = "name";
  return o[p[k]];
}
function keyBehindMember(o) {
  const k = "name";
  return o.a[k].b;
}
tell("key in a key, the outer", () => keyInKey(null, {}));
tell("key in a key, the inner", () => keyInKey({}, null));
tell("key behind a member", () => keyBehindMember({ a: null }));
