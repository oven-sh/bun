// A handler sees an object that a loop has carried as the block behind the loop has left it.
const kept = [];
class V { constructor(x, y) { this.x = x; this.y = y; } static add(a, b) { return new V(a.x + b.x, a.y + b.y); } set both(v) { this.x = v; this.y = v; } }
function boom(i) { if (i > 2) throw new Error("boom"); }
function f0(n) { let a = new V(0, 1); try { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); kept.push(a); a.x = 50; boom(n); } catch (e) { return a.x + " " + (kept.at(-1) === a); } return a.x; }
function f1(n) { let a = new V(0, 1); try { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); a.x = 50; boom(n); } catch (e) { return a.x + " " + a.y; } return a.x; }
function f2(n) { let a = new V(0, 1), t = ""; for (let i = 0; i < 4; i++) { try { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); a.x = 50 + i; boom(n); kept.push(a); boom(i + 1); } catch (e) { t += a.x + " " + (kept.at(-1) === a) + ";"; } } return t + a.x; }
function f3(n) { let a = new V(0, 1), t = ""; try { for (let i = 0; i < 4; i++) { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); kept.push(a); a.x += 0.5; boom(i); } } catch (e) { t += a.x + " " + (kept.at(-1) === a) + ";"; a.y = -1; } finally { t += a.y + "f" + (kept.at(-1).y === a.y); } return t + a.x; }
function f4(n) { let a = new V(0, 1), t = ""; try { for (const v of [1, 2, 3, 4]) { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); a.x = v * 100; if (v === 3) boom(9); t += a.x; } } catch (e) { t += "c" + a.x; } return t; }
function f5(n) { let a = new V(0, 1); try { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); a.both = 7; boom(n); a.both = 8; boom(9); } catch (e) { return a.x + " " + a.y; } return a.x; }
function f6(n) { let a = new V(0, 1), s = ""; try { for (let i = 0; i < 3; i++) { for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); a.both = i + 0.5; s += a.x; boom(i + n); } } catch (e) { s += "c" + a.x + a.y; a.x = 9; kept.push(a); } finally { a.y = a.x + 1; } return s + a.x + a.y + kept.length; }
function f7(n) { let a = new V(0, 1), b = new V(1, 1); try { for (let j = 0; j < n; j++) { a = V.add(a, b); b = V.add(b, a); } b.both = a.x; boom(n); kept.push(a, b); boom(9); } catch (e) { return [a.x, a.y, b.x, b.y, kept.at(-1) === b, kept.at(-2) === a].join(); } return 0; }
function g0(n) { let a = new V(0, 1); for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); try { a.x = 50; boom(n); } catch (e) { return a.x + "c"; } return a.x; }
function g1(n) { let a = new V(0, 1); for (let j = 0; j < n; j++) a = V.add(a, new V(j, 1)); try { kept.push(a); a.x = 50; boom(n); a.y = 8; boom(9); } catch (e) { return a.x + "c" + a.y + (kept.at(-1) === a); } return a.x; }
function g2(n, xs) { let a = new V(0, 1); for (let j = 0; j < xs.length; j++) a = V.add(a, new V(xs[j], 1)); try { a.x = 50; boom(n); a.x = 60; boom(9); } catch (e) { return a.x + "c" + a.y; } return a.x; }
function g3(n, xs) { let a = new V(0, 1), t = ""; for (let i = 0; i < 3; i++) { for (let j = 0; j < xs.length; j++) a = V.add(a, new V(xs[j], 1)); try { a.x = 50 + i; boom(n); a.x = 60 + i; boom(9); } catch (e) { t += a.x + "c" + a.y + ";"; } } return t + a.x; }
function g4(n, xs) { let a = new V(0, 1), t = ""; try { for (let i = 0; i < 3; i++) { for (let j = 0; j < xs.length; j++) a = V.add(a, new V(xs[j], 1)); a.both = 50 + i; boom(n + i); } } catch (e) { t += a.x + "c" + a.y + ";"; } finally { a.x += 1; kept.push(a); } return t + a.x + kept.length; }
function g5(n, xs) { let a = new V(0, 1), t = ""; for (const x of xs) { a = V.add(a, new V(x, 1)); try { a.x += 100; boom(n + x); } catch (e) { t += a.x + ","; a.y = 0; } } return t + a.x + a.y; }
function g6(n, xs) { let a = new V(0, 1), t = ""; try { for (const x of xs) { a = V.add(a, new V(x, 1)); a.x += 100; boom(n + x); a.y -= 1; } } catch (e) { t += a.x + ","; a.y += 0.5; } return t + a.x + a.y; }
function g7(n, xs) { let a = new V(0, 1), t = ""; try { let i = 0; while (true) { a = V.add(a, new V(i, 1)); if (i++ > n) break; } a.x = -1; boom(n); t = "no"; } catch { t = "c" + a.x + "/" + a.y; } return t + a.x; }
function g8(n, xs) { let a = new V(0, 1); outer: try { for (let i = 0; i < 9; i++) { for (let j = 0; j < 3; j++) { a = V.add(a, new V(1, 1)); if (j + i > n) { a.x = 77; boom(n + 1); break outer; } } } a.y = 33; boom(9); } catch { return "c" + a.x + "/" + a.y; } return a.x + "/" + a.y; }
for (let r = 0; r < 3; r++) for (const xs of [[], [1, 2, 3], [0.5, 4]]) for (const n of [0, 1, 3, 5]) {
  console.log(r, n, [f0, f1, f2, f3, f4, f5, f6, f7, g0, g1, g2, g3, g4, g5, g6, g7, g8].map(f => f(n, xs)).join(" ; "));
  kept.length = 0;
}
