const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Root {}

class Person extends Root {
  constructor(first) {
    super();
    this.first = first;
  }
}

class NamedPerson extends Root {
  constructor(first, nickname) {
    super();
    this.first = first;
    this.nickname = nickname;
  }
}

class Child extends Person {}

function OldPerson(first) {
  this.first = first;
}
OldPerson.prototype = Object.create(Root.prototype);
OldPerson.prototype.constructor = OldPerson;

const subjects = [
  ["a class instance without nickname", () => new Person("ann")],
  ["a class instance with nickname", () => new NamedPerson("ann", "annie")],
  ["a class instance whose nickname was deleted", () => { const person = new NamedPerson("ann", "annie"); delete person.nickname; return person; }],
  ["a class instance whose nickname is undefined", () => new NamedPerson("ann", undefined)],
  ["an instance of a class one level further down", () => new Child("ann")],
  ["an instance of a constructor function", () => new OldPerson("ann")],
  ["a literal under the root", () => ({ __proto__: Root.prototype, first: "ann" })],
  ["an object made from the root", () => Object.assign(Object.create(Root.prototype), { first: "ann" })],
  ["an object that inherits from an instance", () => Object.create(new Person("ann"))],
  ["parsed JSON moved under the root", () => Object.setPrototypeOf(JSON.parse('{"first":"ann"}'), Root.prototype)],
  ["a literal that is not under the root", () => ({ first: "ann" })],
  ["an instance moved away from the root", () => Object.setPrototypeOf(new Person("ann"), null)],
];

function read(person) {
  return person.nickname;
}

function readThroughAChain(person) {
  return person?.nickname;
}

function readWithFallback(person) {
  return person.nickname || "no nickname";
}

function destructureWithDefault(person) {
  const { nickname = "default nickname" } = person;
  return nickname;
}

function ask(person) {
  return "nickname" in person;
}

function own(person) {
  return Object.hasOwn(person, "nickname");
}

function walk(person) {
  const names = [];
  for (const name in person) names.push(name);
  return names;
}

function list(person) {
  return Object.keys(person);
}

function copy(person) {
  return { ...person };
}

function toJson(person) {
  return JSON.stringify(person);
}

function store(person) {
  person.nickname = "stored";
  return [Object.hasOwn(person, "nickname"), person.nickname];
}

const uses = [
  ["read", read],
  ["?.", readThroughAChain],
  ["||", readWithFallback],
  ["default", destructureWithDefault],
  ["in", ask],
  ["hasOwn", own],
  ["for-in", walk],
  ["keys", list],
  ["spread", copy],
  ["json", toJson],
  ["store", store],
];

function look(phase) {
  for (const [label, make] of subjects) {
    const parts = uses.map(([name, use]) => {
      try {
        return name + " " + show(use(make()));
      } catch (error) {
        return name + " threw " + error.constructor.name;
      }
    });
    console.log(phase + " | " + label + " | " + parts.join(" | ") + " | log " + log.splice(0).join(", "));
  }
}

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new NamedPerson("ann", "annie")), use(new Person("bob"));
look("untouched");

Root.prototype.nickname = "everyone";
look("a plain member");
delete Root.prototype.nickname;

Object.defineProperty(Root.prototype, "nickname", { value: "hidden from for-in", writable: true, configurable: true });
look("a member that is not enumerable");
delete Root.prototype.nickname;

Object.defineProperty(Root.prototype, "nickname", { value: "read-only", writable: false, enumerable: true, configurable: true });
look("a member that cannot be written");
delete Root.prototype.nickname;

Object.defineProperty(Root.prototype, "nickname", {
  get() {
    log.push("get on " + typeof this);
    return "from a getter";
  },
  set(value) {
    log.push("set on " + typeof this);
  },
  configurable: true,
});
look("an accessor");
delete Root.prototype.nickname;

Root.prototype[["nick", "name"].join("")] = "under a joined name";
look("stored under a joined name");
delete Root.prototype.nickname;

Person.prototype.nickname = "every person";
look("a member of Person.prototype only");
delete Person.prototype.nickname;

look("removed again");
