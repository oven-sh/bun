const call = (o, a) => o.m(a);

function tailCall(o, a) {
  "use strict";
  return o.m(a);
}

function tagged(a) {
  return this.tag + " " + a;
}

function createOutOfLine() {
  const object = { tag: "own out of line" };
  for (let i = 0; i < 12; i++) object["p" + i] = i;
  object.m = tagged;
  return object;
}

function createInherited(tag, levels) {
  let prototype = { m: tagged };
  for (let i = 1; i < levels; i++) prototype = Object.create(prototype);
  const object = Object.create(prototype);
  object.tag = tag;
  return object;
}

const map = new Map([[1, "map value"]]);
map.m = map.get;

const receivers = [
  ["own inline", { tag: "own inline", m: tagged }, 1],
  ["own out of line", createOutOfLine(), 2],
  ["inherited one level", createInherited("one level", 1), 3],
  ["inherited three levels", createInherited("three levels", 3), 4],
  [
    "getter",
    {
      tag: "getter",
      get m() {
        return tagged;
      },
    },
    5,
  ],
  ["bound", { tag: "unused", m: tagged.bind({ tag: "bound" }) }, 6],
  ["proxy", { tag: "proxy", m: new Proxy(tagged, {}) }, 7],
  ["map get", map, 1],
];

class NotCallable {}

const failures = [
  ["undefined", { m: undefined }],
  ["absent", {}],
  ["number", { m: 1 }],
  ["object", { m: {} }],
  ["class", { m: NotCallable }],
  ["primitive receiver", "x"],
  ["number receiver", 1],
];

function report(label, f, o, a) {
  try {
    console.log(label, f(o, a));
  } catch (error) {
    console.log(label, error.name, error instanceof TypeError);
  }
}

for (const f of [call, tailCall]) {
  for (const [label, object, argument] of receivers) report(label, f, object, argument);
  for (const [label, object] of failures) report(label, f, object, 0);
}

let differences = 0;
for (let round = 0; round < 2000; round++) {
  for (const [, object, argument] of receivers) {
    if (call(object, argument) !== tailCall(object, argument)) differences++;
  }
}
console.log("differences", differences);
