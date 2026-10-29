// A function object with a displayName given out of the compiler's sight is called where the compiler knows its function, so the call may be inlined. It leaves by a tail call into a plain function object of the same function, and the other way round. One function for each way to write the tail call.
const names = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/ ?\(.*\)$/, "").replace(/^at /, "").replace(/^.*\.mjs:.*$/, "module"))
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const rename = (f, name) => void (handedBack(f).displayName = name);
let last = "";
let before = "";
let watched = false;
// A site that runs once is not worth inlining, and a loop of a known few turns is unrolled.
const turns = handedBack(3);

const makeByValue = () =>
  function byValue(next) {
    if (next && watched) before = new Error("x").stack;
    if (next) return next(null);
    last = new Error("x").stack;
    return 0;
  };
const makeMethod = () =>
  function method(holder) {
    if (holder && watched) before = new Error("x").stack;
    if (holder) return holder.next(null);
    last = new Error("x").stack;
    return 0;
  };
const makeLending = () =>
  function lending(next, ask) {
    if (next && watched) before = new Error("x").stack;
    if (next) return next(null, () => ask);
    last = new Error("x").stack;
    return 0;
  };
const makeSpread = () =>
  function spread(next, list) {
    if (next && watched) before = new Error("x").stack;
    if (next) return next(...list);
    last = new Error("x").stack;
    return 0;
  };
const makeForwarding = () =>
  function forwarding(next) {
    if (next && watched) before = new Error("x").stack;
    if (next) return next.apply(undefined, arguments.length > 5 ? arguments : []);
    last = new Error("x").stack;
    return 0;
  };
const makeManyArguments = () =>
  function manyArguments(next, a, b, c, d, e, f, g) {
    if (next && watched) before = new Error("x").stack;
    if (next) return next(null, a, b, c, d, e, f, g);
    last = new Error("x").stack;
    return 0;
  };

function show(label, renamedFirst, plainFirst) {
  renamedFirst();
  console.log(label, "| renamed > plain |", names(before), "|", names(last));
  plainFirst();
  console.log(label, "| plain > renamed |", names(before), "|", names(last));
}
function callsByValue() {
  const renamed = makeByValue(), plain = makeByValue();
  rename(renamed, "renamedByValue");
  const renamedUnknown = handedBack(renamed), plainUnknown = handedBack(plain);
  let sum = 0;
  show(
    "by value",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(plainUnknown);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(renamedUnknown);
      }
    },
  );
  return sum;
}
function callsMethod() {
  const renamed = makeMethod(), plain = makeMethod();
  rename(renamed, "renamedMethod");
  const toRenamed = handedBack({ next: renamed }), toPlain = handedBack({ next: plain });
  let sum = 0;
  show(
    "method",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(toPlain);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(toRenamed);
      }
    },
  );
  return sum;
}
function callsLending() {
  const renamed = makeLending(), plain = makeLending();
  rename(renamed, "renamedLending");
  const renamedUnknown = handedBack(renamed), plainUnknown = handedBack(plain);
  let sum = 0;
  show(
    "lending",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(plainUnknown, i);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(renamedUnknown, i);
      }
    },
  );
  return sum;
}
function callsSpread() {
  const renamed = makeSpread(), plain = makeSpread();
  rename(renamed, "renamedSpread");
  const renamedUnknown = handedBack(renamed), plainUnknown = handedBack(plain);
  const list = handedBack([null]);
  let sum = 0;
  show(
    "spread",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(plainUnknown, list);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(renamedUnknown, list);
      }
    },
  );
  return sum;
}
function callsForwarding() {
  const renamed = makeForwarding(), plain = makeForwarding();
  rename(renamed, "renamedForwarding");
  const renamedUnknown = handedBack(renamed), plainUnknown = handedBack(plain);
  let sum = 0;
  show(
    "forwarding",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(plainUnknown);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(renamedUnknown);
      }
    },
  );
  return sum;
}
function callsManyArguments() {
  const renamed = makeManyArguments(), plain = makeManyArguments();
  rename(renamed, "renamedManyArguments");
  const renamedUnknown = handedBack(renamed), plainUnknown = handedBack(plain);
  let sum = 0;
  show(
    "many arguments",
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += renamed(plainUnknown, 1, 2, 3, 4, 5, 6, i);
      }
    },
    () => {
      for (let i = 0; i < turns; i++) {
        watched = i === turns - 1;
        sum += plain(renamedUnknown, 1, 2, 3, 4, 5, 6, i);
      }
    },
  );
  return sum;
}
callsByValue();
callsMethod();
callsLending();
callsSpread();
callsForwarding();
callsManyArguments();
