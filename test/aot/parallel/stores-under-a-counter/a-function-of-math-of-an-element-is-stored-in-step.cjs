// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (x === null || x === undefined) return String(x); if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.map.call(x, v => Object.is(v, -0) ? "-0" : String(v)).join(",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(String).join(",") + "]"; return "object " + JSON.stringify(x); }
function roots(xs, out) { for (let i = 0; i < xs.length; i++) out[i] = Math.sqrt(xs[i]); return out; }
function floors(xs, out) { for (let i = 0; i < xs.length; i++) out[i] = Math.floor(xs[i]); return out; }
function greatest(xs, ys, out) { for (let i = 0; i < xs.length; i++) out[i] = Math.max(xs[i], ys[i]); return out; }
function differences(xs, ys, out) { for (let i = 0; i < xs.length; i++) out[i] = xs[i] - ys[i]; return out; }
const byName = { roots, floors, greatest, differences }, name = text => JSON.parse('"' + text + '"');
function attempt(title, run, ...beside) { let said; try { said = show(run()); } catch (error) { said = error.constructor.name; } console.log(title, said, "|", beside.map(show).join(" | ")); }
for (let round = 0; round < 2; round++)
  for (const kind of [Float64Array, Float32Array, Uint8Array, Int16Array, Uint8ClampedArray]) {
    const whole = new Uint8Array(128).fill(3);
    const xs = kind.from([1, 4, 9, 2, 250, 7]), ys = kind.from([9, 1, 9, 3, 5]);
    for (const which of ["roots", "floors"]) {
      attempt(which + " " + kind.name + " into its own kind", () => byName[name(which)](xs, new kind(whole.buffer, 32, 6)), whole);
      attempt(which + " " + kind.name + " into a shorter one", () => byName[name(which)](xs, new kind(4)));
      attempt(which + " " + kind.name + " into floats", () => byName[name(which)](xs, new Float64Array(6)));
      { const same = kind.from(xs); attempt(which + " " + kind.name + " into itself", () => byName[name(which)](same, same), same); }
      for (const [title, make] of [["a list", () => [0, 0]], ["an empty list", () => []], ["an object", () => ({})], ["null", () => null]])
        attempt(which + " " + kind.name + " into " + title, () => byName[name(which)](xs, make()));
    }
    for (const which of ["greatest", "differences"]) {
      attempt(which + " " + kind.name, () => byName[name(which)](xs, ys, new kind(6)));
      attempt(which + " " + kind.name + " and a list", () => byName[name(which)](xs, [0.5, "7", , 2], new kind(6)));
      attempt(which + " " + kind.name + " into a list", () => byName[name(which)](xs, ys, []));
    }
  }
attempt("roots of fractions below nought", () => byName[name("roots")](Float64Array.of(-1, -0, 0.25, NaN, Infinity), new Float64Array(5)));
attempt("floors of fractions", () => byName[name("floors")](Float64Array.of(-1.5, -0, -0.25, 2.75, NaN), new Float64Array(5)));
attempt("roots of a list", () => byName[name("roots")]([4, "9", , null, 2.25], []));
