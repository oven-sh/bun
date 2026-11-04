// Object.create makes objects two steps below a literal with a getter, a method, a setter and a value. One function reads, calls and stores through them while the literal, the object in
// between and single objects are changed in every way the language has: each round prints what every object answers.
"use strict";
const log = [];
const members = {
  get size() { return this.items.length; },
  has(item) { return this.items.includes(item); },
  set limit(value) { this._limit = value; this.changes++; },
  get limit() { return this._limit; },
  kind: "plain",
  describe() { return this.kind + ":" + this.name; },
};
const between = Object.create(members);
function make(name, above = between) {
  const made = Object.create(above);
  made.name = name;
  made.items = [name];
  made.changes = 0;
  return made;
}
function use(object, turn) {
  let answer = "";
  try { answer += object.size; } catch (error) { answer += error.constructor.name; }
  try { answer += "," + object.has(object.name); } catch (error) { answer += "," + error.constructor.name; }
  try { object.limit = turn; answer += "," + object.limit; } catch (error) { answer += "," + error.constructor.name; }
  try { answer += "," + object.kind + "," + object.describe(); } catch (error) { answer += "," + error.constructor.name; }
  answer += "," + object.missing + "," + object.changes + "," + ("size" in object) + "," + Object.hasOwn(object, "limit");
  return answer;
}
const kept = [make("first"), make("second"), make("third")];
function round(what) {
  const fresh = make("fresh");
  const seen = new Set();
  for (let turn = 0; turn < 40; turn++) {
    for (const object of [...kept, fresh]) seen.add(object.name + "=" + use(object, turn % 2));
  }
  log.push(what + " | " + [...seen].join(" ; ") + " | keys " + Object.keys(fresh).join() + " | all " + allNames(fresh) + " | " + JSON.stringify(fresh));
}
function allNames(object) {
  const names = [];
  for (const name in object) names.push(name);
  return names.join();
}
round("as written");
members.has = function (item) { return "replaced " + item; };
round("a method is replaced");
Object.defineProperty(members, "size", { get() { return -1; }, configurable: true, enumerable: true });
round("a getter is redefined");
Object.defineProperty(members, "kind", { get() { return "computed " + this.name; }, configurable: true, enumerable: false });
round("a value becomes a getter");
delete members.describe;
round("a method is deleted");
members.describe = function () { return "again " + this.name; };
round("the method comes back");
Object.defineProperty(between, "size", { value: 77, writable: true, configurable: true, enumerable: true });
round("the object in between hides the getter");
delete between.size;
round("and shows it again");
kept[0].has = () => "own";
Object.defineProperty(kept[1], "size", { value: "own size", configurable: true });
round("two objects hide members by properties of their own");
delete kept[0].has;
delete kept[1].size;
round("and lose them");
Object.setPrototypeOf(kept[2], { get size() { return "elsewhere"; }, has() { return "elsewhere"; } });
round("one object hangs elsewhere");
Object.setPrototypeOf(kept[2], between);
round("and comes back");
members.missing = "found";
round("a name that nothing had appears on the literal");
delete members.missing;
round("and goes");
Object.defineProperty(members, "name", { set(value) { log.push("setter of name got " + value); }, get() { return "no name"; }, configurable: true });
round("a name that make() stores gets a setter above");
delete members.name;
Object.defineProperty(between, "items", { value: ["fixed"], writable: false, configurable: true });
try { round("a name that make() stores is read-only above"); } catch (error) { log.push("read-only above: " + error.constructor.name); }
delete between.items;
round("and is free again");
delete kept[0].name;
members.name = "inherited name";
round("an object loses a name of its own and inherits one");
delete members.name;
const other = Object.create({ get size() { return "other chain"; }, has() { return false; }, kind: "other", describe() { return "other"; } });
kept.push(make("below another", other));
round("the same call makes an object below another object");
Object.setPrototypeOf(between, { get size() { return "new top"; }, has() { return "new top"; }, describe() { return "new top"; } });
round("the object in between hangs below another literal");
Object.setPrototypeOf(between, members);
round("and back");
Object.freeze(members);
round("the literal is frozen");
Object.freeze(between);
round("the object in between is frozen");
Object.preventExtensions(kept[0]);
Object.freeze(kept[1]);
try { round("objects are closed and frozen"); } catch (error) { log.push("closed: " + error.constructor.name); }
console.log(log.join("\n"));
