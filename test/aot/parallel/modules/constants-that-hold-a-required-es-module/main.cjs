// `const a = require("./m.mjs")` stands for the namespace of the module from that statement on, and for nothing before it.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
globalThis.say = say;
const attempt = (label, run) => {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
};

function readsEarly() {
  return counter.count;
}
function callsEarly() {
  return counter.increment();
}
attempt("a member in the dead zone of the constant:", readsEarly);
attempt("a hoisted function in the dead zone of the constant:", callsEarly);

say("before the call");
const counter = require("./counter.mjs");
say("behind the call");
attempt("a member behind the statement:", readsEarly);
attempt("a call behind the statement:", callsEarly);
say("the binding is live:", counter.count);
say("typeof:", typeof counter.count, typeof counter.increment, typeof counter.absent);

const receiver = require("./receiver.mjs");
say("this in a call through the constant is the namespace:", receiver.describeThis());
say("this in a detached call:", (0, receiver.describeThis)());

const looked = require("./looked-at.mjs");
say("an absent name:", looked.absent);
say("the marker:", looked.__esModule);
say("keys:", Object.keys(looked).join());
say("in:", "one" in looked, "absent" in looked);
say("computed:", looked["o" + "ne"]);
attempt("a store in sloppy code:", () => ((looked.one = 5), looked.one));
attempt("a store in strict code:", () => {
  "use strict";
  looked.one = 5;
  return looked.one;
});
attempt("delete:", () => delete looked.one);
say("optional chain:", looked?.one);

const outer = require("./outer.mjs");
say("a namespace in a namespace:", outer.inner.one, outer.inner.absent, typeof outer.inner);

const { one, absent = "a default" } = require("./looked-at.mjs");
say("a pattern copies:", one, absent);

function loadsLate(flag) {
  if (!flag) return "not loaded";
  const late = require("./late.mjs");
  return late.value;
}
say("in a function, not taken:", loadsLate(false));
say("in a function, taken:", loadsLate(true));
say("in a function, again:", loadsLate(true));

for (const turn of [1, 2]) {
  const again = require("./counter.mjs");
  say("in a loop:", turn, again.count);
}

attempt("a body that throws:", () => {
  const broken = require("./throws.mjs");
  return broken.value;
});
attempt("a body that has thrown:", () => {
  const broken = require("./throws.mjs");
  return broken.value;
});

const exporter = require("./exports-the-constant.mjs");
say("an exported constant holds the namespace:", typeof exporter.held, exporter.held.one, Object.keys(exporter.renamed).join());
require("./imports-the-constant.mjs");
const word = ["AKeyAlone"][lines.length - lines.length];
attempt("what nobody names, through an exported constant:", () => exporter["unn" + "amed"]["reachedBy" + word]());
say("its keys:", Object.keys(exporter.unnamed).join());

require("./replaces-require.cjs");
require("./evaluates-text.cjs");

console.log(lines.join("\n"));
