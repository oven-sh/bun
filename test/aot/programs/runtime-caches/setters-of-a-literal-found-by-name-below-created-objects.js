// One place stores under a name on objects made by Object.create, two steps below a literal that has the accessor. Later the setter is replaced, becomes a value, a read-only value,
// a getter alone, is deleted, is hidden by a property of the object in between or of the receiver, the object in between gets another prototype, and the literal is frozen.
"use strict";
const log = [];
const answers = {
  get status() {
    return this.code;
  },
  set status(code) {
    log.push("set " + code + " on " + this.label);
    this.code = code;
  },
  label: "the literal",
};
const between = Object.create(answers);
between.label = "between";
function make(label) {
  const made = Object.create(between);
  made.label = label;
  return made;
}
function store(object, value) {
  object.status = value;
}
function attempt(what, object, value) {
  try {
    store(object, value);
    log.push(what + ": " + String(object.status) + " own " + Object.keys(object).join(","));
  } catch (error) {
    log.push(what + ": " + error.constructor.name + " own " + Object.keys(object).join(","));
  }
}
for (let i = 0; i < 60; i++) store(make("warm"), i);
log.length = 0;
attempt("as written", make("a"), 1);
Object.defineProperty(answers, "status", {
  set(code) {
    log.push("another setter " + code);
    this.code = -code;
  },
});
attempt("another setter", make("b"), 2);
Object.defineProperty(answers, "status", { get: undefined, set: undefined });
attempt("neither getter nor setter", make("c"), 3);
Object.defineProperty(answers, "status", { get() { return "got"; }, set: undefined });
attempt("a getter alone", make("d"), 4);
Object.defineProperty(answers, "status", { value: "a value", writable: true });
attempt("a value", make("e"), 5);
Object.defineProperty(answers, "status", { writable: false });
attempt("a value nobody writes", make("f"), 6);
delete answers.status;
attempt("deleted", make("g"), 7);
Object.defineProperty(answers, "status", {
  set(code) {
    log.push("back " + code);
  },
  configurable: true,
});
attempt("back", make("h"), 8);
Object.defineProperty(between, "status", {
  set(code) {
    log.push("between " + code);
  },
  configurable: true,
});
attempt("hidden in between by a setter", make("i"), 9);
Object.defineProperty(between, "status", { value: "in between", writable: true });
attempt("hidden in between by a value", make("j"), 10);
delete between.status;
attempt("no longer hidden", make("k"), 11);
const own = make("l");
Object.defineProperty(own, "status", { value: "own", writable: true, enumerable: true });
attempt("hidden by the receiver", own, 12);
Object.setPrototypeOf(between, { set status(code) { log.push("another parent " + code); } });
attempt("another parent", make("m"), 13);
Object.setPrototypeOf(between, answers);
attempt("the first parent again", make("n"), 14);
Object.freeze(answers);
attempt("frozen", make("o"), 15);
attempt("a frozen receiver", Object.freeze(make("p")), 16);
Object.setPrototypeOf(between, null);
attempt("no parent", make("q"), 17);
console.log(log.join("\n"));
