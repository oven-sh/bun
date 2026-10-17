function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
tell("a closure in the heritage sees the class", () => {
  let probe;
  class C extends (probe = function () { return C; }, Object) {}
  return probe() === C;
});
tell("of a class expression, the inner name", () => {
  const C = "outside";
  let probe;
  const made = class C extends (probe = () => C, Object) {};
  return probe() === made && C === "outside";
});
tell("the inner name is not assigned to", () => {
  let set;
  const made = class C extends (set = () => { C = null; }, Object) {};
  set();
  return made;
});
tell("called within the heritage it is in the dead zone", () => {
  class C extends (() => C)() {}
  return C;
});
tell("each evaluation has its own", () => {
  const probes = [];
  const classes = [];
  for (let i = 0; i < 3; i++) classes.push(class C extends (probes.push(() => C), Object) { static index = i; });
  return probes.map((probe, i) => probe() === classes[i] && probe().index === i).join();
});
tell("beside a computed key and a method that name it", () => {
  let fromHeritage, fromKey;
  class C extends (fromHeritage = () => C, Object) {
    [(fromKey = () => C, "method")]() { return C; }
  }
  return [fromHeritage() === C, fromKey() === C, new C().method() === C].join();
});
tell("a variable of the function around is seen as it is when the closure runs", () => {
  let count = 0;
  let probe;
  class C extends (probe = () => [C.name, count], count++, Object) {}
  count += 10;
  return probe().join();
});
let atTheTop;
class AtTheTop extends (atTheTop = () => AtTheTop, Object) {}
console.log("at the top level", atTheTop() === AtTheTop);
