// The kin: accessors, a static member and a symbol, each under a var that is read above its store.
function make() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return class Crate {
    get [SEEN]() { return 3 + work; }
    set [SET](value) { this.kept = value; }
    static [SHARED]() { return 5 + work; }
    [MARK]() { return 7 + work; }
  };
}
const Early = make();
var SEEN = "seen";
var SET = "set";
var SHARED = "shared";
var MARK = Symbol("mark");
const Late = make();
for (const Made of [Early, Late]) {
  const crate = new Made();
  crate.set = 1;
  console.log(Reflect.ownKeys(Made.prototype).map(String).join(), Reflect.ownKeys(Made).map(String).join(), crate.seen, crate.kept, typeof Made.shared, typeof crate[MARK], typeof crate["undefined"]);
}
