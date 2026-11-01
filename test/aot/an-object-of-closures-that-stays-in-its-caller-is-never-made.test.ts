import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const rounds = `
let total = 0;
for (let i = 0; i < 1000; i++) total += turn(i & 7);
console.log(total);
`;
const programs: Record<string, string> = {
  "used in a loop": `
function cursor(list) {
  let at = -1;
  return { step() { return ++at < list.length; }, value() { return list[at]; } };
}
const list = [1, 2, 3, 4];
function turn(i) {
  const c = cursor(list);
  let sum = i;
  while (c.step()) sum += c.value();
  return sum;
}
${rounds}`,
  "one of two that the function returns": `
function cursor(list, backwards) {
  let at = backwards ? list.length : -1;
  if (backwards) return { step() { return --at >= 0; }, value() { return list[at]; } };
  return { step() { return ++at < list.length; }, value() { return list[at]; } };
}
const list = [1, 2, 3, 4];
function turn(i) {
  const c = cursor(list, false);
  let sum = i;
  while (c.step()) sum += c.value();
  return sum;
}
${rounds}`,
  // What Babel writes for \`for (const x of list)\`.
  "the helper of a loop over a list": `"use strict";
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}
function _createForOfIteratorHelper(r, e) {
  var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (!t) {
    if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
      t && (r = t);
      var _n = 0,
        F = function F() {};
      return {
        s: F,
        n: function n() {
          return _n >= r.length ? {
            done: !0
          } : {
            done: !1,
            value: r[_n++]
          };
        },
        e: function e(r) {
          throw r;
        },
        f: F
      };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var o,
    a = !0,
    u = !1;
  return {
    s: function s() {
      t = t.call(r);
    },
    n: function n() {
      var r = t.next();
      return a = r.done, r;
    },
    e: function e(r) {
      u = !0, o = r;
    },
    f: function f() {
      try {
        a || null == t["return"] || t["return"]();
      } finally {
        if (u) throw o;
      }
    }
  };
}
var list = [1, 2, 3, 4];
function turn(i) {
  var s = i;
  var _iterator = _createForOfIteratorHelper(list), _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var v = _step.value;
      s += v;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return s;
}
${rounds.replace("let total", "var total").replace("let i", "var i")}`,
};

for (const [form, program] of Object.entries(programs)) {
  test(`an object of closures over a scope, ${form}: its maker is copied into the caller and the object is never made`, async () => {
    using dir = tempDir("aot-object-of-closures-stays-in-its-caller", { "main.js": program });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      writesProgramInto(folder),
      "main.js",
      "--outfile",
      "main",
    ];
    built(await spawned(command, folder, env));
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "13500\n", exitCode: 0 });

    const turn = (await printIR(folder, { until: "Select", functionName: "turn" })).split("\n");
    expect(turn.filter(line => / = NewClosure /.test(line))).toEqual([]);
    // The helper of Babel has calls of its own on the ways that are not taken.
    if (!program.includes("_createForOfIteratorHelper"))
      expect(turn.filter(line => / = CallDirect /.test(line))).toEqual([]);
    expect(turn.filter(line => /Slot.* key="(step|value|s|n|e|f)" /.test(line))).toEqual([]);
  }, 120_000);
}
