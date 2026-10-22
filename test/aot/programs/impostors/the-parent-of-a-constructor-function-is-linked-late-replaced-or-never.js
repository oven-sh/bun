function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function describe(label, made, Child, Parent) {
  attempt(label + " greet:", () => made.greet());
  attempt(label + " kind:", () => made.kind);
  attempt(label + " own name:", () => made.name);
  attempt(label + " instanceof child:", () => made instanceof Child);
  attempt(label + " instanceof parent:", () => made instanceof Parent);
  attempt(label + " prototype is the child's:", () => Object.getPrototypeOf(made) === Child.prototype);
  attempt(label + " keys:", () => {
    const keys = [];
    for (const key in made) keys.push(key);
    return keys.join();
  });
}

function Early(name) {
  this.name = name;
}
Early.prototype.greet = function () {
  return "early " + this.name;
};
Early.prototype.kind = "early";

function LinkedLate(name) {
  Early.call(this, name);
}
const beforeTheLink = new LinkedLate("first");
describe("constructed before the link", beforeTheLink, LinkedLate, Early);
LinkedLate.prototype = Object.create(Early.prototype);
LinkedLate.prototype.constructor = LinkedLate;
const afterTheLink = new LinkedLate("second");
describe("constructed after the link", afterTheLink, LinkedLate, Early);
describe("the one from before, again", beforeTheLink, LinkedLate, Early);

function Other(name) {
  this.name = name + "!";
}
Other.prototype.greet = function () {
  return "other " + this.name;
};
Other.prototype.kind = "other";

function Relinked(name) {
  Early.call(this, name);
}
Object.setPrototypeOf(Relinked.prototype, Early.prototype);

function greetAll(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text = list[i].greet() + list[i].kind.length;
  return text;
}

const many = [];
for (let i = 0; i < 2000; i++) many.push(new Relinked("r" + i));
attempt("2000 with the first parent:", () => greetAll(many));
Object.setPrototypeOf(Relinked.prototype, Other.prototype);
attempt("the same 2000 after the parent was replaced:", () => greetAll(many));
describe("constructed after the replacement", new Relinked("late"), Relinked, Other);
describe("against the first parent", many[0], Relinked, Early);
Object.setPrototypeOf(Relinked.prototype, null);
attempt("the same 2000 without any parent:", () => greetAll(many));
Object.setPrototypeOf(Relinked.prototype, Early.prototype);
attempt("the same 2000 with the first parent again:", () => greetAll(many));

function NeverLinked(name) {
  Early.call(this, name);
}
if (many.length === 0) NeverLinked.prototype = Object.create(Early.prototype);
describe("the link is in a branch that is not taken", new NeverLinked("n"), NeverLinked, Early);

function linkByName(child, parentName) {
  const parents = { Early, Other };
  child.prototype = Object.create(parents[parentName].prototype);
}
function LinkedByName(name) {
  this.name = name;
}
linkByName(LinkedByName, JSON.parse('"Other"'));
describe("the parent is chosen by a computed name", new LinkedByName("c"), LinkedByName, Other);

function TwoLinks(name) {
  this.name = name;
}
TwoLinks.prototype = Object.create(Early.prototype);
const underTheFirst = new TwoLinks("one");
TwoLinks.prototype = Object.create(Other.prototype);
const underTheSecond = new TwoLinks("two");
describe("under the first of two links", underTheFirst, TwoLinks, Early);
describe("under the second of two links", underTheSecond, TwoLinks, Other);

function MethodChanges(name) {
  Early.call(this, name);
}
MethodChanges.prototype = Object.create(Early.prototype);
const changing = [];
for (let i = 0; i < 100; i++) changing.push(new MethodChanges("m" + i));
attempt("before the parent's method changes:", () => greetAll(changing));
Early.prototype.greet = function () {
  return "changed " + this.name;
};
attempt("after the parent's method changed:", () => greetAll(changing));
MethodChanges.prototype.greet = function () {
  return "hidden " + this.name;
};
attempt("after the child hides it:", () => greetAll(changing));
delete MethodChanges.prototype.greet;
attempt("after the child shows it again:", () => greetAll(changing));
changing[99].greet = () => "own ";
attempt("after the last instance gets its own:", () => greetAll(changing));
