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

function* range(from, to, step) {
  for (let i = from; i < to; i += step) yield i;
}

function* bits(value) {
  for (let i = 0; i < 4; i++) yield (value >> i) & 1;
}

function* countdown(n) {
  while (n > 0) yield n--;
  return n;
}

function* scaled(list, factor) {
  for (let i = 0; i < list.length; i++) yield list[i] * factor;
}

async function doubledLater(value) {
  await null;
  return value * 2;
}

async function maskedLater(value) {
  const before = value & 7;
  await null;
  return [before, value & 7, value | 0];
}

async function incrementedAcrossAwaits(value) {
  value++;
  await null;
  value++;
  await null;
  return value;
}

async function summedLater(a, b) {
  const first = await a;
  return first + b;
}

async function* ticking(from, count) {
  for (let i = 0; i < count; i++) yield from + i;
}

function take(iterator, limit) {
  const seen = [];
  for (const value of iterator) {
    seen.push(value);
    if (seen.length === limit) break;
  }
  return seen;
}

async function takeAsync(iterator, limit) {
  const seen = [];
  for await (const value of iterator) {
    seen.push(value);
    if (seen.length === limit) break;
  }
  return seen;
}

async function attemptAsync(label, run) {
  try {
    console.log(label, "->", show(await run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

const impostors = ["2", "", "abc", 0.5, -0, null, undefined, true, 2n, NaN, 2147483647, 4294967297, [2], { valueOf: () => 2 }, Symbol("s")];

async function main() {
  for (let i = 0; i < 500; i++) {
    take(range(i, i + 3, 1), 5);
    take(bits(i), 5);
    take(countdown(3), 5);
    take(scaled([1, 2], i), 5);
    await doubledLater(i);
    await maskedLater(i);
    await incrementedAcrossAwaits(i);
    await summedLater(i, 1);
    await takeAsync(ticking(i, 2), 5);
  }
  for (const value of impostors) {
    const label = show(value);
    attempt("range(" + label + ", 5, 1)", () => take(range(value, 5, 1), 6));
    attempt("range(0, " + label + ", 1)", () => take(range(0, value, 1), 6));
    attempt("range(0, 5, " + label + ")", () => take(range(0, 5, value), 6));
    attempt("bits(" + label + ")", () => take(bits(value), 6));
    attempt("countdown(" + label + ")", () => take(countdown(value), 3));
    attempt("scaled([1, 2], " + label + ")", () => take(scaled([1, 2], value), 6));
    attempt("scaled([1, " + label + "], 2)", () => take(scaled([1, value], 2), 6));
    await attemptAsync("doubledLater(" + label + ")", () => doubledLater(value));
    await attemptAsync("maskedLater(" + label + ")", () => maskedLater(value));
    await attemptAsync("incrementedAcrossAwaits(" + label + ")", () => incrementedAcrossAwaits(value));
    await attemptAsync("summedLater(" + label + ", 1)", () => summedLater(value, 1));
    await attemptAsync("summedLater(1, " + label + ")", () => summedLater(1, value));
    await attemptAsync("ticking(" + label + ", 2)", () => takeAsync(ticking(value, 2), 6));
    await attemptAsync("ticking(1, " + label + ")", () => takeAsync(ticking(1, value), 3));
  }
  await attemptAsync("honest calls afterwards", async () => [take(range(0, 3, 1), 5), take(bits(5), 5), await doubledLater(2), await maskedLater(9), await incrementedAcrossAwaits(1)]);
}

main();
