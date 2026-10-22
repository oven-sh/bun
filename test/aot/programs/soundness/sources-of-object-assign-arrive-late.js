// Sources of Object.assign arrive late, have getters, and the target changes.
function run(f) { "x".replace("x", f); }
function main() {
  let source = { a: 1 };
  let target = {};
  const first = target;
  function change() { source = { get a() { target = { second: true }; return "from getter"; }, b: { deep: 1 } }; return ""; }
  for (let i = 0; i < 3; i++) { Object.assign(target, source); run(change); }
  console.log(typeof first.a, typeof first.b, first.b.deep, typeof target.a, target.second);
  const many = Object.assign({}, { x: 1 }, null, "ab", [true], { x: "last" });
  console.log(typeof many.x, many[0], many[1]);
  const withSetter = { set v(value) { this.seen = typeof value; } };
  Object.assign(withSetter, { v: { o: 1 } });
  console.log(withSetter.seen);
  const frozen = Object.freeze({ f: 1 });
  try { Object.assign(frozen, { f: 2 }); console.log("assigned"); } catch (e) { console.log("threw", frozen.f); }
}
main();
