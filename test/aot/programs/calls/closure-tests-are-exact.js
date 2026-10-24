// One call site receives every kind of callee, before and after each closure changes, and reports which body ran.
let ran = "none";

function declared() {
  ran = "declared";
}

function makeAdder(amount) {
  return function adder() {
    ran = "adder " + amount;
  };
}

function makeLeft(label) {
  return function left() {
    ran = "left " + label;
  };
}

function makeRight(label) {
  return function right() {
    ran = "right " + label;
  };
}

async function asyncBody() {
  ran = "async";
}

function* generatorBody() {
  ran = "generator";
}

class Box {
  constructor() {
    ran = "class";
  }
}

function boundTarget() {
  ran = "bound " + this.label;
}

function invoke(callee, isConstructed) {
  return isConstructed ? new callee() : callee();
}

function run(callee, isConstructed) {
  ran = "none";
  try {
    const result = invoke(callee, isConstructed);
    if (result && typeof result.next === "function") result.next();
    return ran + " " + typeof result + " " + (typeof result === "number" ? result : "");
  } catch (error) {
    return error.constructor.name;
  }
}

function deletePrototype(callee) {
  try {
    return delete callee.prototype;
  } catch (error) {
    return error.constructor.name;
  }
}

const first = makeAdder(1);
const second = makeAdder(2);
const third = makeAdder(3);
const arrow = () => {
  ran = "arrow";
};
const left = makeLeft("a");
const right = makeRight("a");

const callees = [
  ["declared", declared],
  ["first", first],
  ["second", second],
  ["third", third],
  ["arrow", arrow],
  ["left", left],
  ["right", right],
  ["async", asyncBody],
  ["generator", generatorBody],
  ["class", Box, true],
  ["bound", boundTarget.bind({ label: "receiver" })],
  ["Math.max", Math.max],
  [
    "proxy",
    new Proxy(function proxied() {
      ran = "proxied";
    }, {}),
  ],
  ["null", null],
  ["number", 1],
  ["string", "s"],
  ["object", {}],
];

function report(phase) {
  const answers = callees.map(([, callee, isConstructed]) => run(callee, isConstructed));
  let differences = 0;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < callees.length; i++) {
      if (run(callees[i][1], callees[i][2]) !== answers[i]) differences++;
    }
  }
  console.log(phase, "differences", differences);
  for (let i = 0; i < callees.length; i++) console.log(callees[i][0], "=>", answers[i]);
}

report("unmodified");

second.x = 1;
console.log("delete prototype", deletePrototype(third), "prototype" in third);
arrow.x = 1;
left.x = 1;
right.x = 1;

report("modified");
console.log(second.x, arrow.x, left.x === right.x);
