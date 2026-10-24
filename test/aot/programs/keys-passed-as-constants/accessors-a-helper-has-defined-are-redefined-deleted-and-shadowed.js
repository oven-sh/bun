// A helper object defines accessors on a holder under names it is handed; each forwards to a member of the receiver. Then everything they rest on changes.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
function Forwarder(holder, member) {
  if (!(this instanceof Forwarder)) return new Forwarder(holder, member);
  this.holder = holder;
  this.member = member;
  this.names = [];
}
Forwarder.prototype.getter = function (name) {
  var holder = this.holder,
    member = this.member;
  this.names.push(name);
  holder.__defineGetter__(name, function () {
    return this[member][name];
  });
  return this;
};
Forwarder.prototype.setter = function (name) {
  var holder = this.holder,
    member = this.member;
  this.names.push(name);
  holder.__defineSetter__(name, function (value) {
    return (this[member][name] = value);
  });
  return this;
};
Forwarder.prototype.access = function (name) {
  return this.getter(name).setter(name);
};
const hidden = process.argv.length > 9 ? "x" : "";
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
const exchange = {};
const toAnswer = Forwarder(exchange, "answer").access("code").access("size").getter("sent");
const toQuestion = Forwarder(exchange, "question").access("path").getter("verb");
function make() {
  const made = Object.create(exchange);
  made.question = { path: "/", verb: "GET" };
  made.answer = { code: 200, size: 0, sent: false };
  return made;
}
function look(made) {
  return [made.code, made.size, made.sent, made.path, made.verb].join();
}
let made = make();
say(look(made), toAnswer.names.join(), toQuestion.names.join());
made.code = 404;
made.path = "/x";
say(attempt(() => (made.sent = true)), attempt(() => (made.verb = "PUT")));
say(look(made), made.answer.code, made.question.path, Object.keys(made).join());
// The helper is called with a name made at run time, and with the same name for the other member.
toAnswer.getter("la" + hidden + "te");
made.answer.late = "late";
say(made.late);
toQuestion.getter("code");
made.question.code = "of the question";
say(made.code, look(make()));
toAnswer.getter("code");
say(made.code);
// The member is swapped, is missing, is a primitive.
made.answer = { code: 1, size: 2, sent: 3 };
say(look(made));
made.answer = "text";
say(made.code, made.size);
delete made.answer;
try {
  say(made.code);
} catch (error) {
  say(error.constructor.name);
}
// An accessor is shadowed on the object, on an object between, deleted from the holder, redefined as a value.
made = make();
Object.defineProperty(made, "code", { value: "own", configurable: true });
say(made.code, make().code);
delete made.code;
say(made.code);
const between = Object.create(exchange);
between.__defineGetter__("size", function () {
  return "between";
});
const lower = Object.create(between);
lower.answer = { size: 5, code: 6, sent: 7 };
lower.question = { path: "p", verb: "v" };
say(look(lower));
delete exchange.sent;
say(look(make()), "sent" in make());
Object.defineProperty(exchange, "verb", { value: "fixed", writable: true, configurable: true });
say(look(make()));
exchange.__defineGetter__("path", function () {
  return "another getter";
});
say(look(make()));
made = make();
made.path = "stored through the old setter";
say(made.question.path, made.path);
// The accessors taken off the holder and called on something else.
const taken = Object.getOwnPropertyDescriptor(exchange, "code");
say(typeof taken.get, typeof taken.set, taken.enumerable, taken.configurable, taken.get.call({ answer: { code: "elsewhere" } }), taken.get.name, taken.get.length, taken.set.length);
say(exchange.__lookupGetter__("code") === taken.get, exchange.__lookupGetter__("size") === taken.get, exchange.__lookupGetter__("size").toString() === taken.get.toString());
// The helper's own method is replaced, and the built-in it calls is shadowed on the holder.
const original = Forwarder.prototype.getter;
Forwarder.prototype.getter = function (name) {
  say("replaced", name);
  return original.call(this, name);
};
toAnswer.getter("more");
Forwarder.prototype.getter = original;
const odd = {
  __defineGetter__(name, getter) {
    say("own definer", name, typeof getter);
  },
};
Forwarder(odd, "answer").getter("code");
say(Object.keys(odd).join());
// Names that are indexes, __proto__, symbols.
const other = {};
const mark = Symbol("mark");
Forwarder(other, "inner").getter("0").getter("__proto__").getter(mark).getter("");
const under = Object.create(other);
under.inner = { 0: "zero", [mark]: "marked", "": "empty" };
say(under[0], under.__proto__ === Object.prototype, Object.getPrototypeOf(under) === other, under[mark], under[""]);
console.log(lines.join("\n"));
