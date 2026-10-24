function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function upToTheLargest() {
  const seen = [];
  for (let i = 2147483645; i <= 2147483647; i++) {
    seen.push(i);
    if (seen.length > 6) break;
  }
  return seen;
}

function pastTheLargest() {
  const seen = [];
  for (let i = 2147483645; i < 2147483650; i++) seen.push(i);
  return seen;
}

function downToTheSmallest() {
  const seen = [];
  for (let i = -2147483646; i >= -2147483648; i--) {
    seen.push(i);
    if (seen.length > 6) break;
  }
  return seen;
}

function pastTheSmallest() {
  const seen = [];
  for (let i = -2147483646; i > -2147483651; i--) seen.push(i);
  return seen;
}

function byThreeToTheLargest() {
  const seen = [];
  for (let i = 2147483640; i < 2147483647; i += 3) seen.push(i);
  return seen;
}

function afterTheLoop() {
  let i = 2147483645;
  for (; i <= 2147483647; i++);
  return [i, i | 0, i + 1];
}

function whileNotEqual() {
  let i = 2147483646;
  let rounds = 0;
  while (i !== 2147483649) {
    i++;
    rounds++;
    if (rounds > 6) break;
  }
  return [i, rounds];
}

function unsignedBound() {
  const seen = [];
  for (let i = 4294967293; i <= 4294967295; i++) {
    seen.push(i, i >>> 0, i | 0);
    if (seen.length > 20) break;
  }
  return seen;
}

function countsWithAConstant() {
  const LARGEST = 2147483647;
  let n = LARGEST;
  n++;
  let m = -LARGEST - 1;
  m--;
  return [n, m, n | 0, m | 0];
}

function sumsOfLargeIndexes() {
  let total = 0;
  for (let i = 2147483600; i < 2147483700; i++) total += i;
  return [total, total | 0];
}

function nestedCounters() {
  let count = 2147483640;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) count++;
  return [count, count | 0];
}

function halving() {
  const seen = [];
  for (let i = 5; i > 0; i /= 2) {
    seen.push(i);
    if (seen.length === 5) break;
  }
  return seen;
}

function halvingByAShift() {
  const seen = [];
  for (let i = -2147483648; i !== -1 && i !== 0; i >>= 8) seen.push(i);
  return seen;
}

function halvingByAnUnsignedShift() {
  const seen = [];
  for (let i = -2147483648; i !== 0; i >>>= 8) seen.push(i);
  return seen;
}

const uses = [upToTheLargest, pastTheLargest, downToTheSmallest, pastTheSmallest, byThreeToTheLargest, afterTheLoop, whileNotEqual, unsignedBound, countsWithAConstant, sumsOfLargeIndexes, nestedCounters, halving, halvingByAShift, halvingByAnUnsignedShift];
for (const round of ["first", "second"]) for (const use of uses) attempt(round + " " + use.name, use);
