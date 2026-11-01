import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const turns = 2000;
const files = {
  // What Babel writes for \`for (const x of list)\`.
  "for-of.js": `
    "use strict";
    function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
    function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
    function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
    var list = [1, 2, 3, 4];
    function turn(i) {
      var sum = i;
      var _iterator = _createForOfIteratorHelper(list), _step;
      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var x = _step.value;
          sum += x;
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }
      return sum;
    }
    var total = 0;
    for (var i = 0; i < ${turns}; i++) total += turn(i & 7);
    console.log(total);
  `,
  // An object of closures over the scope that made it, which is kept and used at once.
  "counter.js": `
    function counter(start) {
      let n = start;
      return { add(by) { return (n += by); }, get() { return n; }, reset() { n = start; } };
    }
    const kept = [];
    function turn(i) {
      const c = counter(i);
      kept[i & 3] = c;
      c.add(2);
      c.add(3);
      return c.get();
    }
    let total = 0;
    for (let i = 0; i < ${turns}; i++) total += turn(i & 7);
    kept[0].reset();
    console.log(total, kept.map(c => c.get()).join());
  `,
};

for (const file of Object.keys(files)) {
  test(`${file}: the closures are made beside the reads that want them, not in the runtime`, async () => {
    using dir = tempDir("aot-closures-over-a-scope-used-at-once", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", file, "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });

    const path = join(String(dir), "counts");
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    const plain = await run([bunExe(), file], String(dir), bunEnv);
    expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
    let calls = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name === "operationAOTMaterializeDeferredClosure") calls += Number(count);
    }
    expect(calls).toBeLessThan(turns / 100);
  }, 120_000);
}
