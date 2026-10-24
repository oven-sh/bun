function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Base(id) {
  this.id = id;
}
Base.prototype.describe = function () {
  return "base " + this.id;
};
Base.prototype.shared = "shared by Base";

function describe(thing) {
  return thing.describe();
}

function sharedOf(thing) {
  return thing.shared;
}

function look(label, thing, Maker) {
  attempt(label + ": describe()", () => describe(thing));
  attempt(label + ": shared", () => sharedOf(thing));
  attempt(label + ": own()", () => thing.own());
  attempt(label + ": instanceof its maker, Base", () => [thing instanceof Maker, thing instanceof Base]);
}

function ReplacedLate(id) {
  Base.call(this, id);
}
function makeReplacedLate(id) {
  return new ReplacedLate(id);
}
ReplacedLate.prototype.own = function () {
  return "own method of the first prototype";
};
const beforeReplacement = makeReplacedLate(1);
look("prototype replaced late, made before, looked at before", beforeReplacement, ReplacedLate);
ReplacedLate.prototype = Object.create(Base.prototype);
ReplacedLate.prototype.constructor = ReplacedLate;
look("prototype replaced late, made before, looked at after", beforeReplacement, ReplacedLate);
look("prototype replaced late, made after", makeReplacedLate(2), ReplacedLate);

function RelinkedLate(id) {
  Base.call(this, id);
}
function makeRelinkedLate(id) {
  return new RelinkedLate(id);
}
RelinkedLate.prototype.own = function () {
  return "own method";
};
const beforeRelink = makeRelinkedLate(3);
look("prototype relinked late, made before, looked at before", beforeRelink, RelinkedLate);
Object.setPrototypeOf(RelinkedLate.prototype, Base.prototype);
look("prototype relinked late, made before, looked at after", beforeRelink, RelinkedLate);
look("prototype relinked late, made after", makeRelinkedLate(4), RelinkedLate);

function LinkedInAFunction(id) {
  Base.call(this, id);
}
function makeLinkedInAFunction(id) {
  return new LinkedInAFunction(id);
}
function linkNow() {
  LinkedInAFunction.prototype = Object.create(Base.prototype);
}
const beforeTheCall = makeLinkedInAFunction(5);
look("linked inside a function that was not called yet", beforeTheCall, LinkedInAFunction);
linkNow();
look("after the call, made before", beforeTheCall, LinkedInAFunction);
look("after the call, made after", makeLinkedInAFunction(6), LinkedInAFunction);

function NeverLinked(id) {
  Base.call(this, id);
}
if (JSON.parse("false")) NeverLinked.prototype = Object.create(Base.prototype);
look("the link is in a branch that never runs", new NeverLinked(7), NeverLinked);

function LinkedOnFirstUse(id) {
  if (Object.getPrototypeOf(LinkedOnFirstUse.prototype) !== Base.prototype) Object.setPrototypeOf(LinkedOnFirstUse.prototype, Base.prototype);
  Base.call(this, id);
}
look("the constructor links itself on its first call", new LinkedOnFirstUse(8), LinkedOnFirstUse);

function LinkedAfter2000(id) {
  Base.call(this, id);
}
function makeLinkedAfter2000(id) {
  return new LinkedAfter2000(id);
}
LinkedAfter2000.prototype.describe = function () {
  return "not linked yet " + this.id;
};
let length = 0;
const early = [];
for (let i = 0; i < 2000; i++) {
  const thing = makeLinkedAfter2000(i % 10);
  if (i < 3) early.push(thing);
  length += describe(thing).length + String(sharedOf(thing)).length;
}
console.log("2000 constructions before the link", length);
Object.setPrototypeOf(LinkedAfter2000.prototype, Base.prototype);
delete LinkedAfter2000.prototype.describe;
look("linked after 2000 constructions, made before", early[1], LinkedAfter2000);
look("linked after 2000 constructions, made after", makeLinkedAfter2000(9), LinkedAfter2000);

length = 0;
for (let i = 0; i < 2000; i++) length += describe(new Base(i % 10)).length;
console.log("2000 honest bases", length);
