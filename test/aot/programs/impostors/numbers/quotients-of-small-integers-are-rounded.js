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

function rounded() {
  const seen = { floor: [], ceil: [], round: [], trunc: [], truncated: [], sign: [], abs: [] };
  for (let i = -5; i <= 5; i++) {
    seen.floor.push(Math.floor(i / 4));
    seen.ceil.push(Math.ceil(i / 4));
    seen.round.push(Math.round(i / 4));
    seen.trunc.push(Math.trunc(i / 4));
    seen.truncated.push((i / 4) | 0);
    seen.sign.push(Math.sign(i / 4));
    seen.abs.push(Math.abs(i / 4));
  }
  return seen;
}

function roundedWithANegativeDivisor() {
  const seen = { floor: [], ceil: [], round: [], trunc: [], plain: [] };
  for (let i = -2; i <= 2; i++) {
    seen.floor.push(Math.floor(i / -4));
    seen.ceil.push(Math.ceil(i / -4));
    seen.round.push(Math.round(i / -4));
    seen.trunc.push(Math.trunc(i / -4));
    seen.plain.push(i / -4);
  }
  return seen;
}

function dividedByTheCounter() {
  const seen = { plain: [], floor: [], truncated: [], round: [] };
  for (let i = -2; i <= 2; i++) {
    seen.plain.push(6 / i);
    seen.floor.push(Math.floor(6 / i));
    seen.truncated.push((6 / i) | 0);
    seen.round.push(Math.round(1 / i));
  }
  return seen;
}

function zeroDividedByTheCounter() {
  const seen = [];
  for (let i = -2; i <= 2; i++) seen.push(0 / i, Math.floor(0 / i), Math.round(0 / i));
  return seen;
}

function halves() {
  const seen = { round: [], floorOfPlusHalf: [], ceilOfMinusHalf: [] };
  for (let i = -5; i <= 5; i++) {
    seen.round.push(Math.round(i / 2));
    seen.floorOfPlusHalf.push(Math.floor(i / 2 + 0.5));
    seen.ceilOfMinusHalf.push(Math.ceil(i / 2 - 0.5));
  }
  return seen;
}

function usedAsIndexes() {
  const letters = ["a", "b", "c"];
  const seen = [];
  for (let i = -3; i <= 9; i++) seen.push(letters[Math.floor(i / 3)], letters[Math.ceil(i / 3)], letters[i / 3]);
  return seen;
}

function minimumAndMaximum() {
  const seen = { min: [], max: [], clamped: [] };
  for (let i = -3; i <= 3; i++) {
    seen.min.push(Math.min(i / 2, 0));
    seen.max.push(Math.max(i / 2, 0));
    seen.clamped.push(Math.round(Math.min(Math.max(i / 2, -1), 1)));
  }
  return seen;
}

function negatedQuotients() {
  const seen = [];
  for (let i = 0; i <= 3; i++) seen.push(-(i / 2), Math.floor(-(i / 2)), Math.ceil(-(i / 2)), -Math.floor(i / 2));
  return seen;
}

function sumsOfQuotients() {
  const seen = [];
  for (let i = -2; i <= 2; i++) seen.push(i / 2 + i / 2, i / 2 - i / 2, Math.round(i / 4 + i / 4), Math.ceil(i / 4 - 1 / 4));
  return seen;
}

function comparedWithQuotients() {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    let count = 0;
    for (let j = 0; j < i / 2; j++) count++;
    let inclusive = 0;
    for (let j = 0; j <= i / 2; j++) inclusive++;
    seen.push(count, inclusive);
  }
  return seen;
}

const uses = [rounded, roundedWithANegativeDivisor, dividedByTheCounter, zeroDividedByTheCounter, halves, usedAsIndexes, minimumAndMaximum, negatedQuotients, sumsOfQuotients, comparedWithQuotients];
for (const use of uses) {
  const result = use();
  if (Array.isArray(result)) attempt(use.name, () => result);
  else for (const key of Object.keys(result)) attempt(use.name + " " + key, () => result[key]);
}
