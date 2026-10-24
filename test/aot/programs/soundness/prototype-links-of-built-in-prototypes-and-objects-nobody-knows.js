// A name that is absent from Error.prototype could also come in from above. The prototypes are reached under names that are made at run time, and each way to put an object with a setter,
// or a proxy, above them is tried. The link of a built-in prototype that compiled code has looked past is fixed.
class Node {
  constructor(weight) { this.weight = weight; }
}
class Failure extends TypeError {
  constructor(node) { super("failed"); this.node = node; }
}
function weigh() {
  const failure = new Failure(new Node(3));
  return failure.node.weight + " " + Object.keys(failure).join();
}
console.log(weigh());

function strictProto(holder, above) { "use strict"; holder.__proto__ = above; return "done"; }
const doors = {
  "Object.setPrototypeOf": (holder, above) => { Object.setPrototypeOf(holder, above); return "done"; },
  "Reflect.setPrototypeOf": (holder, above) => Reflect.setPrototypeOf(holder, above),
  "strict __proto__": strictProto,
};
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
const madeAtRunTime = text => text.split("").reverse().join("");
const above = {
  "an object with a setter": () => ({ set node(value) { console.log("a setter ran"); } }),
  "a proxy": () => new Proxy({ }, { set() { console.log("a trap ran"); return true; } }),
};
for (const reversedName of ["rorrEepyT", "rorrE"]) {
  const holder = globalThis[madeAtRunTime(reversedName)][madeAtRunTime("epytotorp")];
  const was = Object.getPrototypeOf(holder);
  for (const door in doors) {
    for (const kind in above)
      console.log(madeAtRunTime(reversedName), door, kind + ":", attempt(() => doors[door](holder, above[kind]())), Object.getPrototypeOf(holder) === was);
  }
}
console.log(weigh());
