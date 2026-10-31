// A helper object forwards names of one object to a member of it, in strict code: the helper is a function declaration of the module, and `access` ends in a call in tail position.
function Forwarder(holder, member) {
  if (!(this instanceof Forwarder)) return new Forwarder(holder, member);
  this.holder = holder;
  this.member = member;
  this.names = [];
}
Forwarder.prototype.getter = function (name) {
  const holder = this.holder,
    member = this.member;
  this.names.push("get " + name);
  holder.__defineGetter__(name, function () {
    return this[member][name];
  });
  return this;
};
Forwarder.prototype.setter = function (name) {
  const holder = this.holder,
    member = this.member;
  this.names.push("set " + name);
  if (name === "refused") throw new Error("no setter for " + name);
  holder.__defineSetter__(name, function (value) {
    return (this[member][name] = value);
  });
  return this;
};
Forwarder.prototype.access = function (name) {
  return this.getter(name).setter(name);
};
Forwarder.prototype.method = function (name) {
  const holder = this.holder,
    member = this.member;
  holder[name] = function () {
    return this[member][name].apply(this[member], arguments);
  };
  return this;
};
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 5)
    .map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "("))
    .join(" < ");
const exchange = {
  describe() {
    return this.question.path + this.answer.code;
  },
};
const first = Forwarder(exchange, "answer").access("code").access("size").getter("sent").method("finish");
const second = Forwarder(exchange, "question").access("path").getter("verb").getter("host");
console.log(first.names.join(), second.names.join(), first === second, first instanceof Forwarder);
function make(i) {
  const made = Object.create(exchange);
  made.question = { path: "/", verb: "GET", host: "a" };
  made.answer = {
    code: 200,
    size: 0,
    sent: false,
    finish(a, b) {
      return this.code + ":" + a + ":" + b + ":" + arguments.length;
    },
  };
  made.code = i & 255;
  made.size = i & 3;
  return made;
}
function sum(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const made = make(i);
    if (made.verb === "GET") s += made.code + made.size;
    if (made.path === "/" && !made.sent) s += 1;
  }
  return s;
}
console.log(
  sum(1000),
  make(7).describe(),
  make(9).finish(1, 2),
  Object.keys(make(1)).join(),
  Object.keys(exchange).join(),
);
console.log(
  JSON.stringify(Object.getOwnPropertyDescriptor(exchange, "code")),
  typeof Object.getOwnPropertyDescriptor(exchange, "sent").set,
);
// The helper throws behind a call in tail position.
try {
  Forwarder(exchange, "answer").access("refused");
} catch (error) {
  console.log(error.message, "|", frames(error));
}
console.log("refused" in exchange, make(1).refused);
// An accessor is defined anew, by hand and by the helper.
Object.defineProperty(exchange, "size", { get: () => "by hand", configurable: true });
Forwarder(exchange, "question").getter("code");
console.log(make(5).size, make(5).code, sum(10));
// The helper's own member is another function when the next chain runs.
Forwarder.prototype.getter = function (name) {
  this.holder[name] = "plain " + name;
  return this;
};
const third = Forwarder(exchange, "answer").access("late").getter("later");
console.log(exchange.late, exchange.later, third.names.join());
// A holder and a member that nobody writes out.
const holders = [{}, {}];
for (const [index, holder] of holders.entries())
  Forwarder(holder, index ? "b" : "a")
    .setter("x")
    .method("call");
holders[0].a = { call: () => "a" };
holders[1].b = { call: () => "b" };
holders[0].x = 1;
holders[1].x = 2;
console.log(holders[0].a.x, holders[1].b.x, holders[0].call(), holders[1].call());
