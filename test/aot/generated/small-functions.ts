// Small functions that a compiler takes into their callers: closures made in loops that keep the turn's own variable, closures that call
// themselves, pairs that call each other, functions that only a loop calls, copies two and three deep, parameters that are stored to, defaults
// that look at earlier parameters, `arguments`, rest parameters, early returns out of loops and out of try and finally, labels, `this` by the way
// a function is called, getters, captured variables that both sides change. Whole numbers only. A line for each function: what forty calls yield.
//
// A program is a seed. The same seed always writes the same program.
import { randomFrom } from "./constant-expressions";

export function program(seed: number, isTypeScript: boolean): { file: string; text: string } {
  const { next, choice, upTo } = randomFrom(seed);
  const N = isTypeScript ? ": number" : "";
  const lines = isTypeScript ? ["// @ts-nocheck"] : [];
  lines.push(`let shared = 0; const trail${isTypeScript ? ": number[]" : ""} = [];`);
  const names: string[] = [];
  const call = (depth = 0): string => {
    if (names.length === 0 || next() < 0.15) return choice(["a", "b", "(a + b | 0)", "(a ^ b)", String(upTo(-3, 9))]);
    const f = choice(names.slice(-12));
    const given = Array.from({ length: choice([2, 2, 2, 1, 3]) }, () => choice(["a", "b", "a + 1 | 0", "b - 1 | 0", "a & 7", String(upTo(0, 5)), ...(depth < 2 ? [call(depth + 1)] : [])]));
    return `${f}(${given.join(", ")})`;
  };
  // prettier-ignore
  const forms: ((n: string) => string)[] = [
    n => `function ${n}(a${N}, b${N}) { return (${call()} + ${call()}) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { if ((a & 3) === ${upTo(0, 3)}) return ${call()}; return (${call()} * 3) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { let s = 0; for (let i = 0; i < (a & 7); i++) { s = (s + ${call()} + i) | 0; } return s; }`,
    n => `function ${n}(a${N}, b${N}) { const fs = []; for (let i = 0; i < 4; i++) fs.push(() => (i * 10 + ${call()}) | 0); let s = 0; for (const f of fs) s = (s * 7 + f()) | 0; return s; }`,
    n => `function ${n}(a${N}, b${N}) { const fs = []; for (var i = 0; i < 4; i++) fs.push(() => i + a); let s = 0; for (const f of fs) s = (s * 7 + f()) | 0; return s; }`,
    n => `function ${n}(a${N}, b${N}) { const fs = []; for (let i = 0; i < 4; i++) { fs.push(() => i); i += a & 1; } return fs.map(f => f()).join("").length + fs.reduce((s, f) => s + f(), 0); }`,
    n => `function ${n}(a${N}, b${N}) { const down = (k${N})${N} => (k <= 0 ? ${call()} : (down(k - 1) + k) | 0); return down(a & 7); }`,
    n => `function ${n}(a${N}, b${N}) { const go = function self(k${N})${N} { return k <= 0 ? b : (self(k - 2) * 2 + ${call()}) | 0; }; return go(a & 7); }`,
    n => `function ${n}(a${N}, b${N}) { const even = (k${N})${N} => (k === 0 ? 1 : odd(k - 1)); const odd = (k${N})${N} => (k === 0 ? 0 : even(k - 1)); return even(a & 15) * 10 + odd(b & 15); }`,
    n => `function ${n}(a${N}, b${N}) { a = (a + 1) | 0; const r = ${call()}; b = (b ^ a) | 0; return (r + a * 2 + b) | 0; }`,
    n => `function ${n}(a${N}, b${N} = a + 1, c${N} = b * 2) { return (a + b * 3 + c * 5 + ${call()}) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { return (arguments.length * 100 + (arguments[1] === undefined ? 7 : arguments[1] & 7) + ${call()}) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { a = 5; return (arguments[0] | 0) + a + (b | 0); }`,
    n => `function ${n}(a${N}, ...rest${isTypeScript ? ": number[]" : ""}) { const b = rest.length; return (a + rest.length * 10 + (rest[0] | 0) + ${call()}) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { for (let i = 0; i < 5; i++) { for (let j = 0; j < 5; j++) { if (i * j === (a & 7)) return (i * 10 + j + ${call()}) | 0; } } return -1; }`,
    n => `function ${n}(a${N}, b${N}) { try { if (a & 1) return ${call()}; shared = (shared + 1) | 0; return 2; } finally { shared = (shared + 10) | 0; } }`,
    n => `function ${n}(a${N}, b${N}) { try { if ((a & 3) === 0) throw a; return ${call()}; } catch (e) { return (e + 1000) | 0; } finally { trail.push(a & 1); } }`,
    n => `function ${n}(a${N}, b${N}) { let s = 0; outer: for (let i = 0; i < 6; i++) { for (let j = 0; j < 6; j++) { if (j === (b & 3)) continue outer; if (i === (a & 7)) break outer; s = (s + ${call()}) | 0; } } return s; }`,
    n => `function ${n}(a${N}, b${N}) { let n = 0; const up = () => { n = (n + a) | 0; return n; }; const twice = () => up() + up(); n = b; return (twice() * 3 + n + up()) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { const o = { v: a, m() { return (this.v + ${call()}) | 0; }, get g() { return this.v * 2; } }; const m = o.m; let r = o.m() + o.g; try { r += m.call({ v: b }); } catch { r += 1; } return r | 0; }`,
    n => `function ${n}(a${N}, b${N}) { let s = 0; for (let i = 0; i < 3; i++) { const k = (x${N}) => (x + i + ${call()}) | 0; s = (s * 5 + k(a) + k(b)) | 0; } return s; }`,
    n => `function ${n}(a${N}, b${N}) { shared = (shared + a) | 0; const before = shared; const r = ${call()}; return (r + shared - before) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { const mk = (k${N}) => () => () => (k + a) | 0; return (mk(1)()() + mk(b)()() * 3 + ${call()}) | 0; }`,
    n => `function ${n}(a${N}, b${N}) { let i = 0, s = 0; while (true) { if (i++ > (a & 3)) break; s = (s + ${call()}) | 0; } do { s = (s + i--) | 0; } while (i > 0); return s; }`,
    n => `function ${n}(a${N}, b${N}) { switch (a & 3) { case 0: return ${call()}; case 1: b = (b + 1) | 0; case 2: return (b * 2) | 0; default: return ${call()}; } }`,
    n => `function ${n}(a${N}, b${N}) { const [x, y = x + 1] = [a, (b & 1) ? undefined : b]; const { p = ${call()}, q = p + 1 } = (a & 1) ? { p: b } : {}; return (x + y * 3 + p * 5 + q * 7) | 0; }`,
    n => `function* gen_${n}(a${N}, b${N}) { for (let i = 0; i < (a & 3) + 1; i++) yield (i + ${call()}) | 0; return 9; } function ${n}(a${N}, b${N}) { let s = 0; for (const v of gen_${n}(a, b)) s = (s * 3 + v) | 0; return s; }`,
    n => `class C_${n} { v${N}; constructor(v${N}) { this.v = v; } add(k${N}) { return new C_${n}((this.v + k) | 0); } get twice() { return (this.v * 2) | 0; } static of(v${N}) { return new C_${n}(v); } } function ${n}(a${N}, b${N}) { return (C_${n}.of(a).add(b).add(${call()}).twice) | 0; }`,
  ];
  for (let i = 0; i < 70; i++) {
    lines.push(choice(forms)("f" + i));
    names.push("f" + i);
  }
  for (const n of names) lines.push(`{ let h = 0; const first = []; for (let i = 0; i < 40; i++) { let r; try { r = ${n}(i * 7 - 20, i % 5); } catch (e) { r = -777; } h = (h * 31 + (r | 0)) | 0; if (i < 4) first.push(r); } console.log("${n} ==> " + h + " " + first.join() + " " + shared + " " + trail.length); }`);
  return { file: isTypeScript ? "main.ts" : "main.mjs", text: lines.join("\n") + "\n" };
}
