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

let ticks = 0;
var hoisted = 0;
const frozen = 5;

function tick() {
  return ++ticks;
}

function bucket() {
  return ticks & 7;
}

function doubled() {
  return ticks * 2;
}

function plusOne() {
  return ticks + 1;
}

function store(value) {
  ticks = value;
  hoisted = value;
}

function add(value) {
  ticks += value;
}

function readHoisted() {
  return [hoisted, hoisted | 0, hoisted + frozen];
}

for (let i = 0; i < 2000; i++) {
  tick();
  bucket();
  doubled();
  plusOne();
  hoisted++;
  readHoisted();
}
console.log("after 2000 honest rounds", ticks, hoisted);

for (const value of [0.5, NaN, 2147483647, 2147483648, -2147483649, -0, Infinity, "3", "", undefined, null, true, 3n, [4], { valueOf: () => 5 }, Symbol("s")]) {
  const label = show(value);
  store(value);
  attempt(label + " read at the top", () => [ticks, typeof ticks]);
  attempt(label + " bucket", bucket);
  attempt(label + " doubled", doubled);
  attempt(label + " plusOne", plusOne);
  attempt(label + " readHoisted", readHoisted);
  attempt(label + " tick", () => [tick(), ticks]);
  store(1);
  attempt(label + " added to 1", () => {
    add(value);
    return [ticks, bucket()];
  });
  store(1);
  attempt(label + " and an integer again", () => [tick(), bucket(), doubled(), plusOne()]);
}

export {};
