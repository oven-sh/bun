const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function Parent(value) {
  this.fromParent = value;
}
Parent.prototype.read = function () {
  return this.fromParent;
};

function ChildByCall(value) {
  Parent.call(this, value);
  this.fromChild = value;
}
ChildByCall.prototype = Object.create(Parent.prototype);

function ChildByApply(value) {
  Parent.apply(this, arguments);
  this.fromChild = value;
}
ChildByApply.prototype = Object.create(Parent.prototype);

function readOf(thing) {
  return thing.read();
}

function look(phase) {
  attempt(phase + ": a child that uses call", () => new ChildByCall(1));
  attempt(phase + ": its read()", () => readOf(new ChildByCall(1)));
  attempt(phase + ": a child that uses apply", () => new ChildByApply(2));
  attempt(phase + ": its read()", () => readOf(new ChildByApply(2)));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += readOf(new ChildByCall(i % 5)) + readOf(new ChildByApply(i % 3));
console.log("2000 honest children each", sum);
look("untouched");

Parent.call = function (receiver, value) {
  log.push("the parent's own call");
  receiver.fromOwnCall = value;
};
look("the parent has its own call");

Parent.apply = function (receiver, values) {
  log.push("the parent's own apply with " + values.length);
  receiver.fromOwnApply = values[0];
};
look("and its own apply");

delete Parent.call;
delete Parent.apply;
look("both deleted");

Object.defineProperty(Parent, "call", { get() { log.push("get call"); return Function.prototype.call; }, configurable: true });
look("call is a getter that answers the built-in");
delete Parent.call;

Parent.call = 5;
look("call is a number");
delete Parent.call;

Object.setPrototypeOf(Parent, {
  call(receiver, value) {
    log.push("call from the parent's new prototype");
    receiver.fromNewPrototype = value;
  },
});
look("the parent function has another prototype");
Object.setPrototypeOf(Parent, null);
look("the parent function has no prototype");
Object.setPrototypeOf(Parent, Function.prototype);
look("put back");

Parent[["ca", "ll"].join("")] = function (receiver) {
  log.push("call stored under a joined name");
  receiver.joined = true;
};
look("a call was stored under a joined name");
delete Parent.call;
look("at the end");
