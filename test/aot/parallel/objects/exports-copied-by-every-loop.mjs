// Modules that fill their exports by a loop over the names of other exports.
const lines = [];
const say = (...values) => lines.push(values.map(value => (typeof value === "function" ? "function " + value() : String(value))).join());
const commonjs = (body, mod) => () => (mod || body((mod = { exports: {} }).exports, mod), mod.exports);
const core = commonjs(function (exports) {
  function step() {
    return 7;
  }
  exports.step = step;
  exports.other = 5;
  exports.text = "text";
});
const byKeys = commonjs(function (exports) {
  const inner = core();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
const byOf = commonjs(function (exports) {
  const inner = core();
  for (const key of Object.keys(inner)) exports[key] = inner[key];
});
const byIn = commonjs(function (exports) {
  const inner = core();
  for (const key in inner) exports[key] = inner[key];
});
const byEntries = commonjs(function (exports) {
  for (const [key, value] of Object.entries(core())) exports[key] = value;
});
const both = commonjs(function (exports) {
  const inner = core();
  exports.own = 3;
  Object.keys(inner).forEach(function (key) {
    if (key === "text" || Object.prototype.hasOwnProperty.call(exports, key)) return;
    exports[key] = inner[key];
  });
});
const again = commonjs(function (exports) {
  const inner = byKeys();
  Object.keys(inner).forEach(function (key) {
    exports[key] = inner[key];
  });
});
const numbers = commonjs(function (exports) {
  exports.one = 1;
  exports.two = 2;
  if (exports.one < exports.two) exports.three = 3;
});
const numbersAgain = commonjs(function (exports) {
  const inner = numbers();
  Object.keys(inner).forEach(function (key) {
    exports[key] = 10;
  });
});
function captured(outer) {
  const first = outer.step;
  const second = outer.other;
  function later() {
    return [first, second];
  }
  say(...later(), outer.step === undefined);
}
function mapped(outer) {
  const f = outer.step;
  say([f, outer.other, outer.text].map(value => typeof value).join());
}
function neverCalled(outer) {
  const first = outer.step;
  function compile() {
    outer.transform({ steps: [first] });
  }
  say(typeof compile);
}
for (let turn = 0; turn < 2; turn++) {
  for (const outer of [byKeys(), byOf(), byIn(), byEntries(), both(), again()]) {
    captured(outer);
    mapped(outer);
    neverCalled(outer);
  }
}
const outer = byKeys();
const n = outer.other;
const held = () => n;
const list = [held];
say(list[0]() | 0);
const last = again();
const text = last.text;
const step = last.step;
say(...[() => text, () => step].map(f => f()));
const sums = numbersAgain();
const { one, three, missing } = sums;
say(...[() => one, () => three, () => missing].map(f => f()), Object.keys(sums).join("/"));
console.log(lines.join("\n"));
