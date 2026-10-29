// Each variable is stored once. Each loop reads it only in a branch, and the branch is not taken as long as the variable is empty: a read that ran in front of the loop would run where the program never reads.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

// Called in front of the store and behind it.
function sumOfLate(n, from) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= from) sum += late[i & 3];
  }
  return sum;
}
say("in front of the store", sumOfLate(8, 100));
try {
  say("too early", sumOfLate(8, 7));
} catch (error) {
  say("too early", error.constructor.name);
}
const late = new Int32Array([1, 2, 3, 4]);
say("behind the store", sumOfLate(8, 0), sumOfLate(8, 100));

// The loop stands in the body that stores, in front of the store.
for (let i = 0; i < 4; i++) {
  if (i > 10) say("never", besideItsLoop.length);
}
const besideItsLoop = [1, 2, 3];
let total = 0;
for (let i = 0; i < 6; i++) {
  if (i & 1) total += besideItsLoop[i % 3];
}
say("beside its loop", total);

// The store stands behind a call that throws the first time.
let attempts = 0;
function mayThrow() {
  if (attempts++ === 0) throw new RangeError("first");
  return new Float64Array([0.5, 1.5]);
}
let behindThrow;
function readBehindThrow(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (behindThrow !== undefined) sum += behindThrow[i & 1];
  }
  return sum;
}
for (let round = 0; round < 1; round++) {
  try {
    say("round", round, readBehindThrow(4));
  } catch (error) {
    say("round", round, error.constructor.name);
  }
}
try {
  behindThrow = mayThrow();
} catch (error) {
  say("threw", error.message, readBehindThrow(4));
}

// The store stands in a branch.
let inBranch;
if (lines.length > 1000) inBranch = [7];
function readInBranch(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (inBranch) sum += inBranch[0];
    else sum -= 1;
  }
  return sum;
}
say("in a branch", readInBranch(3));

// A function that runs once stores, and its caller reads behind the call.
let filledBySetup;
function setup() {
  filledBySetup = new Uint8Array(4).fill(9);
}
function main(n) {
  let before = 0;
  for (let i = 0; i < n; i++) {
    if (i > n) before += filledBySetup[0];
  }
  setup();
  let after = 0;
  for (let i = 0; i < n; i++) {
    if (i & 1) after += filledBySetup[i & 3];
  }
  return before + after;
}
say("filled by setup", main(8));

// A var, read by a function that runs on both sides of the store.
function readVar(n) {
  let text = "";
  for (let i = 0; i < n; i++) {
    if (i === n - 1) text += typeof hoisted;
  }
  return text;
}
say("var", readVar(3));
var hoisted = { a: 1 };
say("var", readVar(3));

// A callback that the host calls later, made in front of the store.
const later = [];
function schedule(n) {
  later.push(() => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) sum += storedBehindSchedule.get(i % 2) ?? 0;
    }
    return sum;
  });
}
schedule(9);
const storedBehindSchedule = new Map([
  [0, 10],
  [1, 20],
]);
say("scheduled", later[0]());

// A class whose static block runs a loop in front of the store.
class Early {
  static seen = 0;
  static {
    for (let i = 0; i < 3; i++) {
      if (i > 5) Early.seen += behindClass.length;
    }
  }
  static count(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i !== 1) sum += behindClass.length;
    }
    return sum;
  }
}
const behindClass = "four";
say("class", Early.seen, Early.count(3));

// A loop inside a loop, the read in the inner one, which does not turn at first.
function nested(rows, columns) {
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (c >= 0) sum += grid[r * columns + c];
    }
  }
  return sum;
}
say("nested", nested(3, 0));
const grid = new Float32Array(6).fill(2);
say("nested", nested(2, 3));

// A function that is entered in front of the store calls a closure that is made behind it.
function eachTime(n, act) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (act) sum += act(i);
  }
  return sum;
}
say("by value", eachTime(3, null), eachTime(3, i => i));
const behindFirstCall = new Int32Array([5, 6, 7, 8]);
say("by value", eachTime(4, i => behindFirstCall[i & 3]));

// The same with one closure alone, so that the call names it.
function onlyOne(n, act) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (act) sum += act(i);
  }
  return sum;
}
say("one closure", onlyOne(3, undefined));
const behindOnlyOne = [1.5, 2.5];
say("one closure", onlyOne(4, i => behindOnlyOne[i & 1]));

// A closure kept in a variable that is stored later than the function that calls it is entered.
function callsKept(n, go) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (go) sum += kept(i);
  }
  return sum;
}
say("kept", callsKept(3, false));
const behindKept = new Uint16Array([9, 8]);
const kept = i => behindKept[i & 1];
say("kept", callsKept(4, true));

console.log(lines.join("\n"));
