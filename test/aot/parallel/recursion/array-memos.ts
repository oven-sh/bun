// @ts-nocheck
// Functions that call themselves and keep their answers in arrays: elements that are absent, holes, prototypes with elements, named properties, keys that are no index.
const log = [];
function fib(n, memo) { if (n < 2) return n; if (memo[n] !== undefined) return memo[n]; memo[n] = fib(n - 1, memo) + fib(n - 2, memo); return memo[n]; }
function known(n, memo) { if (n < 2) return n; const held = memo[n]; if (held) return held; return (memo[n] = known(n - 1, memo) + known(n - 2, memo)); }
function down(n, memo) { if (n < -3) return 0; const held = memo[n]; if (held !== undefined) return held; memo[n] = n; return down(n - 1, memo) + 1; }
function halves(n, memo) { if (n > 4) return 0; const held = memo[n]; if (held === undefined) { memo[n] = n + 1; return halves(n + 0.5, memo) + 1; } return held; }
function far(n, memo) { if (n <= 0) return 0; const held = memo[4294967290 + n]; if (held != null) return held; memo[4294967290 + n] = n; return far(n - 1, memo) + 1; }
function seen(n, marks) { if (n > 12 || marks[n]) return 0; marks[n] = true; return 1 + seen(n * 2, marks) + seen(n + 3, marks); }
function only(n, memo) { if (n <= 0) return 0; return (memo[n] === undefined ? 1 : memo[n]) + only(n - 1, memo); }
class Paths { #memo: number[] = []; go(n: number): number { if (n < 2) return 1; const hit = this.#memo[n]; if (hit) return hit; return (this.#memo[n] = this.go(n - 1) + this.go(n - 2)); } }
class List extends Array {}
const makers = [() => [], () => [0, 0, 7], () => new Array(10), () => new Array(10).fill(-1), () => [1.5, , 2.5, , 4.5], () => [, , "two", , "four"], () => Object.freeze([1, 2, 3]), () => Object.setPrototypeOf([], { 3: 33, 5: 55, "-1": 11, "0.5": 12, __proto__: Array.prototype }),
  () => Object.assign([], { "-1": -11, "0.5": 5, "2.5": 25, name: 1 }), () => new List(), () => new Proxy([], {}), () => { const a = []; Object.defineProperty(a, 4, { get() { log.push("g"); return 44; }, set() { log.push("s"); } }); return a; }, () => { const a = [1, 2, 3]; a[5000] = 1; return a; },
  () => new Float64Array(6), () => new Int8Array(40), () => ({}), () => ({ 3: 3, length: 4 }), () => [undefined, null, undefined, null, 0, NaN, ""], () => { const a = [1, 2, 3, 4, 5, 6]; delete a[3]; return a; }, () => "0123456789", () => Object.setPrototypeOf([, , , 3], null)];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
function call(name, f) { let answer; try { answer = show(f()); } catch (e) { answer = e.name; } return name + "=" + answer; }
makers.forEach((make, place) => {
  const said = [];
  for (const [name, f, n] of [["fib", fib, 12], ["known", known, 9], ["down", down, 2], ["halves", halves, 0], ["far", far, 4], ["seen", seen, 1], ["only", only, 8]]) {
    const memo = make();
    said.push(call(name, () => f(n, memo)), call(name, () => f(n, memo)), call(name, () => f(n - 1, memo)));
    let held; try { held = [...Object.keys(memo)].slice(0, 9).join(); } catch (e) { held = e.name; }
    said.push(held);
  }
  console.log(place, said.join(" "), log.length); log.length = 0;
});
console.log(new Paths().go(30));
