let registry = { held: null, shared: true };
function put(box, v) { box.held = v; }
function fill(v, own) { put(own ? { held: null } : registry, v); }

let sharedList = [];
function push(list, v) { list.push(v); }
function fillList(v, own) { push(own ? [] : sharedList, v); }

class Box { held = null; }
let sharedBox = new Box();
function fillBox(v, own) { put(own ? new Box() : sharedBox, v); }

let kept;
const unknown = globalThis[process.argv[9] || "nothingHere"];
function keep(v) { kept = v; return 2; }
function drop(v) { return 1; }
function callOne(which, a, b, x) { return (which ? a : b)(x); }

function runChoices() {
  fill({ n: 1 }, false);
  fill({ n: 2 }, true);
  fillList({ n: 3 }, false);
  fillList({ n: 4 }, true);
  fillBox({ n: 5 }, false);
  fillBox({ n: 6 }, true);
  const answered = callOne(false, unknown || drop, unknown || keep, { m: 7 });
  return [registry.held.n, sharedList[0].n, sharedBox.held.n, answered, kept.m].join(" ");
}
console.log(runChoices());
