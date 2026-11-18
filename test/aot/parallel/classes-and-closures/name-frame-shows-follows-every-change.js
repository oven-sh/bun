// What a frame shows is written down with each change of `displayName`, and no function object is kept for it. So: every way to change the property, many times over at one site,
// with a collection between the change and the call, on every kind of function whose frames show a display name.
const unseen = new Function("x", "return x");
const lines = [];
function shown(stack, ...candidates) {
  return candidates.filter(candidate => stack.includes(candidate)).join("+") || "neither";
}
function fill(depth) {
  const some = [depth, depth + 1, depth + 2];
  return depth ? fill(depth - 1) + some.length : some.length;
}
function collect() { fill(30); Bun.gc(true); }

function declared() { return new Error("x").stack; }
const arrow = () => new Error("x").stack;
const expression = function () { return new Error("x").stack; };
const holder = { method() { return new Error("x").stack; } };
function Constructed() { this.stack = new Error("x").stack; }
class Plain { constructor() { this.stack = new Error("x").stack; } }
class WithField { static displayName = "FieldAtFirst"; constructor() { this.stack = new Error("x").stack; } }
class WithOtherFields { static first = 1; static displayName = "BetweenFields"; static last = 2; constructor() { this.stack = new Error("x").stack; } }

const kinds = [
  ["declared", declared, () => declared()],
  ["arrow", arrow, () => arrow()],
  ["expression", expression, () => expression()],
  ["method", holder.method, () => holder.method()],
  ["Constructed", Constructed, () => new Constructed().stack],
  ["Plain", Plain, () => new Plain().stack],
  ["WithField", WithField, () => new WithField().stack],
  ["WithOtherFields", WithOtherFields, () => new WithOtherFields().stack],
];

function store(target, value) { target.displayName = value; }
function remove(target) { return delete target.displayName; }

for (const [written, target, run] of kinds) {
  const candidates = [written, "FieldAtFirst", "BetweenFields"];
  const say = (label, ...more) => { collect(); lines.push(written + " " + label + ": " + shown(run(), ...candidates, ...more)); };
  say("at first");
  // One site stores to all kinds, thirty times each: whatever remembers how to store has remembered it.
  let answers = "";
  for (let round = 0; round < 30; round++) {
    store(target, "Round" + round + "End");
    if (round % 7 === 6) answers += shown(run(), written, "Round" + round + "End", "Round" + (round - 1) + "End") + " ";
  }
  lines.push(written + " rounds: " + answers);
  say("after the rounds", "Round29End");
  store(target, 7);
  say("a number", "Round29End");
  store(target, "Again");
  say("a string again", "Again");
  store(target, "");
  say("no text", "Again");
  store(target, "Rope" + unseen("Of") + unseen("Parts"));
  say("a rope", "RopeOfParts");
  lines.push(written + " deleted " + remove(target) + " " + ("displayName" in target));
  say("deleted", "RopeOfParts");
  lines.push(written + " deleted again " + remove(target));
  say("deleted again", "RopeOfParts");
  store(target, "Back");
  say("stored behind the deletion", "Back");
  Object.defineProperty(target, "displayName", { value: "Defined", writable: false });
  say("defined, read-only", "Back", "Defined");
  try { (function () { "use strict"; target.displayName = "Refused"; })(); lines.push(written + " stored"); } catch (error) { lines.push(written + " " + error.constructor.name); }
  say("a store that is refused", "Defined", "Refused");
  Object.defineProperty(target, "displayName", { get() { return "Got"; } });
  say("a getter", "Defined", "Got");
  Object.defineProperty(target, "displayName", { value: "ValueAgain", writable: true, enumerable: true, configurable: true });
  say("a value again", "ValueAgain", "Got");
  Object.assign(target, { displayName: "Assigned" });
  say("assigned", "Assigned");
  Reflect.defineProperty(target, "displayName", { value: "Reflected" });
  say("reflected", "Reflected");
  target[unseen("displayName")] = "ByKey";
  say("by a key", "ByKey");
  Reflect.deleteProperty(target, unseen("displayName"));
  say("deleted by a key", "ByKey");
  store(target, "Last");
  say("at last", "Last");
  // Plain Bun shows the property `name` first once something has made JavaScriptCore create it, as freezing does. No frame is named behind this line.
  Object.freeze(target);
  lines.push(written + " keys " + Object.keys(target).join() + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(target, "displayName")));
}

// The property of another object does not count: an heir, a bound function, the prototype object.
function unshared() { return new Error("x").stack; }
const heir = Object.create(unshared);
heir.displayName = "OfTheHeir";
const bound = unshared.bind(null);
bound.displayName = "OfTheBound";
unshared.prototype.displayName = "OfThePrototype";
collect();
lines.push("unshared: " + shown(unshared(), "unshared", "OfTheHeir", "OfTheBound", "OfThePrototype") + " | " + shown(bound(), "unshared", "OfTheBound"));
delete heir.displayName;
delete bound.displayName;
unshared.displayName = "ItsOwn";
collect();
lines.push("unshared: " + shown(unshared(), "unshared", "ItsOwn") + " | " + shown(bound(), "unshared", "ItsOwn", "OfTheBound"));

// Nothing holds these function objects behind the statement that names them.
(function () { function local() { return new Error("x").stack; } local.displayName = "ShownForLocal"; collect(); lines.push("local: " + shown(local(), "local", "ShownForLocal")); })();
(() => { const inner = () => new Error("x").stack; inner.displayName = "ShownForInner"; delete inner.displayName; collect(); lines.push("inner: " + shown(inner(), "inner", "ShownForInner")); })();

console.log(lines.join("\n"));
