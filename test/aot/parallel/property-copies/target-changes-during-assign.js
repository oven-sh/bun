// Object.assign's target is visible to getters of the source, so a getter can change the target between two stores.
function describe(value) {
  return Reflect.ownKeys(value).map(key => {
    const d = Reflect.getOwnPropertyDescriptor(value, key);
    return String(key) + ":" + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ":" + ("value" in d ? String(d.value) : "accessor");
  }).join(" ") + (Object.isExtensible(value) ? "" : " closed");
}
const log = [];
function run(name, change) {
  for (let round = 0; round < 30; round++) {
    const target = { a: 0, b: 0, c: 0 };
    const hostile = round === 20 || round === 25;
    const source = hostile
      ? { a: 1, get b() { change(target, this); return 2; }, c: 3, d: 4 }
      : { a: 1, b: 2, c: 3, d: 4 };
    let outcome;
    try {
      outcome = Object.assign(target, source) === target ? "same" : "other";
    } catch (e) {
      outcome = e.constructor.name;
    }
    if (hostile || round === 29) console.log(name, round, outcome, describe(target), log.splice(0).join(","));
  }
}
run("freeze", t => Object.freeze(t));
run("seal", t => Object.seal(t));
run("prevent extensions", t => Object.preventExtensions(t));
run("setter for c", t => Object.defineProperty(t, "c", { set(v) { log.push("set c " + v); }, configurable: true }));
run("read-only c", t => Object.defineProperty(t, "c", { writable: false }));
run("delete c", t => { delete t.c; });
run("delete a", t => { delete t.a; });
run("add d first", t => { t.d = "early"; });
run("add z", t => { t.z = 26; });
run("prototype with setter d", t => Object.setPrototypeOf(t, { set d(v) { log.push("inherited set d " + v); } }));
run("source loses c", (t, s) => { delete s.c; });
run("source gains e", (t, s) => { s.e = 5; });
run("source c becomes getter", (t, s) => Object.defineProperty(s, "c", { get() { log.push("late getter"); return "late"; }, enumerable: true }));
run("source d hidden", (t, s) => Object.defineProperty(s, "d", { enumerable: false }));
run("many names", t => { for (let i = 0; i < 80; i++) t["n" + i] = i; for (let i = 0; i < 80; i++) delete t["n" + i]; });
