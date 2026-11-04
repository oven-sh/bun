// members above a class are read, called and stored into through super under a key that is written as a text or held by a constant
const KEY = "label";
let log = [];
class Base {
  name() { return "base " + this.id; }
  get label() { log.push("get"); return "label of " + this.id; }
  set label(v) { log.push("set " + v + " on " + this.id); }
}
class Derived extends Base {
  constructor(id) { super(); this.id = id; }
  name() { return "derived, " + super["name"](); }
  get label() { return "derived, " + super[KEY]; }
  set label(v) { super[KEY] = v + "!"; }
  missing() { return super["nothing"]; }
  element() { return super["0"]; }
}
function deed(o) { o.label = "x"; return [o.name(), o.label, o.missing(), o.element()].join(" | "); }
console.log(deed(new Derived(1)));
for (let turn = 0; turn < 3; turn++)
  console.log(deed(new Derived(turn)), log.join());
Base.prototype.name = function () { return "replaced " + this.id; };
Object.defineProperty(Base.prototype, "label", { value: "plain now", writable: true, configurable: true });
Base.prototype[0] = "element above";
console.log(deed(new Derived(9)), log.length);
