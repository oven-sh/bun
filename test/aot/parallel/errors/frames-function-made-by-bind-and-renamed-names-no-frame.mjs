// What bind makes of a function is given a name, and the function is called through it. No stack trace lists a frame for what bind made: the frame is the function's own and bears its name,
// or the name that the function itself was given.
// Keep two things as they are: nothing here renames a function that is written in this file, and all the ways of calling share one function.
// With either changed, a compiler that named two thirds of these frames after what bind made named all of them right.
const names = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.mjs:.*$/, "module"),
    )
    .join(" < ");
const rename = (f, name) => Object.defineProperty(f, "name", { value: name });
// Code that the compiler does not see may run, and may rename whatever it gets hold of.
try {
  new NeverDeclared();
} catch {}

class Held {
  constructor() {
    this.f = function () {};
  }
}
// Functions that are found in an object nobody knows are renamed too.
function renamesWhatItFinds() {
  const given = new Held();
  const other = given.f.bind(given);
  for (const each of Object.values(Object(other))) {
    if (typeof each?.value === "function") rename(each.value, "other");
  }
}

function make() {
  return {
    f() {
      return new Error("x").stack;
    },
  };
}

function byCall(name) {
  const subject = make();
  const bound = rename(subject.f.bind(subject), name);
  console.log("by call |", names(bound.call(subject)));
}

function called(name) {
  const subject = make();
  const bound = rename(subject.f.bind(subject), name);
  console.log("called |", names(bound()));
}

function theFunctionItself(name) {
  const subject = make();
  rename(subject.f.bind(subject), name);
  console.log("the function itself |", names(subject.f()));
}

function notRenamed(name) {
  const subject = make();
  const bound = subject.f.bind(subject);
  console.log("not renamed |", names(bound.call(subject)));
}

function byApply(name) {
  const subject = make();
  const bound = rename(subject.f.bind(subject), name);
  console.log("by apply |", names(bound.apply(subject)));
}

function boundTwice(name) {
  const subject = make();
  const bound = rename(subject.f.bind(subject).bind(null), name);
  console.log("bound twice |", names(bound()));
}

function handedToMap(name) {
  const subject = make();
  const bound = rename(subject.f.bind(null), name);
  console.log("handed to map |", names([1].map(bound)[0]));
}

function byReflectApply(name) {
  const subject = make();
  const bound = rename(subject.f.bind(null), name);
  console.log("by Reflect.apply |", names(Reflect.apply(bound, null, [])));
}

function keptInObject(name) {
  const subject = make();
  const holder = { bound: rename(subject.f.bind(subject), name) };
  console.log("kept in an object |", names(holder.bound()));
}

for (let round = 0; round < 3; round++) {
  byCall("givenA" + round);
  called("givenB" + round);
  theFunctionItself("givenC" + round);
  notRenamed("givenD" + round);
  byApply("givenE" + round);
  boundTwice("givenF" + round);
  handedToMap("givenG" + round);
  byReflectApply("givenH" + round);
  keptInObject("givenI" + round);
  renamesWhatItFinds();
}
