// Five getters are functions bound twice. Each is read by a built-in: Promise.resolve, Object.groupBy, Set.prototype.union, JSON.stringify of a Date, String.prototype.replaceAll. Each of them runs.
let ran = 0;
process.on("unhandledRejection", () => {});
function rc41(o) {
  return typeof Promise.resolve(o);
}
function c41() {
  const o = Promise.resolve(1);
  Object.defineProperty(o, "constructor", {
    get: function () {
      ran++;
      throw new RangeError("thrown");
    }
      .bind()
      .bind(),
    configurable: true,
  });
  return rc41(o);
}
function rc59(o) {
  return typeof Object.groupBy(o, x => x);
}
function c59() {
  const o = {};
  Object.defineProperty(o, Symbol.iterator, {
    get: function () {
      ran++;
      throw new RangeError("thrown");
    }
      .bind()
      .bind(),
    configurable: true,
  });
  return rc59(o);
}
function rc61(o) {
  return new Set().union(o).size;
}
function c61() {
  const o = {};
  Object.defineProperty(o, "size", {
    get: function () {
      ran++;
      throw new RangeError("thrown");
    }
      .bind()
      .bind(),
    configurable: true,
  });
  return rc61(o);
}
function rc74(o) {
  return JSON.stringify(o);
}
function c74() {
  const o = new Date(0);
  Object.defineProperty(o, "toISOString", {
    get: function () {
      ran++;
      throw new RangeError("thrown");
    }
      .bind()
      .bind(),
    configurable: true,
  });
  return rc74(o);
}
function rc89(o) {
  return "a".replaceAll(o, "");
}
function c89() {
  const o = {};
  Object.defineProperty(o, Symbol.replace, {
    get: function () {
      ran++;
      throw new RangeError("thrown");
    }
      .bind()
      .bind(),
    configurable: true,
  });
  return rc89(o);
}
const cases = [
  ["constructor resolve", c41],
  ["iterator groupBy", c59],
  ["iterator union", c61],
  ["toJSON date", c74],
  ["replaceAll", c89],
];
for (const [name, run] of cases) {
  let said;
  const before = ran;
  try {
    said = String(await run());
  } catch (e) {
    said = "throws " + (e && e.name);
  }
  console.log(name + ": " + said.slice(0, 60) + " | the getter ran " + (ran - before));
}
