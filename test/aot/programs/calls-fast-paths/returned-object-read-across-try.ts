// A call returns a small object or array, and a `try`, `catch` or `finally` lies between the call and the reads of its fields.
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => void) { try { body(); } catch (error) { said.push(name + ": THROWS " + (error as Error).constructor.name + " " + (error as Error).message); } }
function big(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += (x + i) * (x - i); if (s > 1e9) s -= 1e9; } return s; }
function record(x: number): { lo: number, hi: number } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return { lo: a, hi: b + 0.5 };
}
function pair(x: number): [number, number] {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return [a, b + 0.25];
}
interface Held { id: number }
function mixed(x: number): { flag: boolean, count: number, name: string, held: Held | null } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return { flag: a > b, count: (a & 1023) | 0, name: "n" + (b & 15), held: (a & 1) ? { id: a & 255 } : null };
}
// The second family: these return a fresh object only once the tiny constructor function has been inlined. They are handled by the last pass, which turns the callers' READS into results in place.
function recordOf(lo: number, hi: number): { lo: number, hi: number } { return { lo, hi }; }
function pairOf(a: number, b: number): [number, number] { return [a, b]; }
function mixedOf(flag: boolean, count: number, name: string, held: Held | null): { flag: boolean, count: number, name: string, held: Held | null } { return { flag, count, name, held }; }
function lateRecord(x: number): { lo: number, hi: number } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return recordOf(a, b + 0.5);
}
function latePair(x: number): [number, number] {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return pairOf(a, b + 0.25);
}
function lateMixed(x: number): { flag: boolean, count: number, name: string, held: Held | null } {
  let a = big(x), b = big(x + 1); for (let i = 0; i < 2; i++) { a += big(a & 7); b += big(b & 7); if (a > 1e12) a = 1; if (b > 1e12) b = 2; }
  return mixedOf(a > b, (a & 1023) | 0, "n" + (b & 15), (a & 1) ? { id: a & 255 } : null);
}
// It changes what registers it can before it throws, three frames down.
function churn(x: number, depth: number): number {
  let a = x + 1, b = x + 2, c = x + 3, d = x + 4, e = x + 5, f = x + 6, g = x + 7, h = x + 8, i = x + 9, j = x + 10, k = x * 1.5, l = x * 2.5, m = x * 3.5, n = x * 4.5;
  for (let t = 0; t < 2; t++) { a += b ^ t; b += c & 31; c += d | 1; d += e ^ a; e += f & b; f += g | c; g += h ^ d; h += i & e; i += j | f; j += a ^ g; k += l * 0.5; l += m * 0.25; m += n * 0.125; n += k * 0.0625; }
  if (depth) return churn(a & 63, depth - 1) + b + c + d + e + f + g + h + i + j + k + l + m + n;
  if (x >= 0) throw new Error("thrown");
  return a + b + c + d + e + f + g + h + i + j + k + l + m + n;
}
function mayThrow(does: boolean, x: number): number { return does ? churn(x & 63, 3) : x; }
const table = [mayThrow];

function behindTheTry(x: number, does: boolean): string { const r = record(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r.lo + " " + r.hi + " " + got; }
function inTheHandler(x: number, does: boolean): string { const r = record(x); try { table[0](does, x); return "none"; } catch (e) { return r.lo + " " + r.hi; } }
function inTheFinally(x: number, does: boolean): string { const r = record(x); let text = ""; try { try { table[0](does, x); } finally { text = r.lo + " " + r.hi; } } catch (e) { text += " caught"; } return text; }
function ofAnArray(x: number, does: boolean): string { const [p, q] = pair(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return p + " " + q + " " + got; }
function ofAnArrayReadLater(x: number, does: boolean): string { const r = pair(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r[0] + " " + r[1] + " " + got; }
function ofEveryKind(x: number, does: boolean): string { const r = mixed(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r.flag + " " + r.count + " " + r.name + " " + (r.held ? r.held.id : "null") + " " + got; }
function inTheTryAheadOfWhatThrows(x: number, does: boolean): string { let lo = -1, hi = -1; try { const r = record(x); lo = r.lo; table[0](does, x); hi = r.hi; } catch (e) { hi = -2; } return lo + " " + hi; }
function twoHandlers(x: number, first: boolean, second: boolean): string { const r = record(x); const s = mixed(x + 1); let text = ""; try { table[0](first, x); text += "a"; } catch (e) { text += r.lo; } try { table[0](second, x); text += "b"; } catch (e) { text += s.name; } return text + " " + r.hi + " " + s.count; }
function inALoop(x: number): string { let text = ""; for (let i = 0; i < 4; i++) { const r = record(x + i); try { table[0]((i & 1) === 1, i); } catch (e) { text += "!"; } text += r.lo + "," + r.hi + ";"; } return text; }
function overAnIteration(x: number, does: boolean): string { const r = record(x); let n = 0; try { for (const v of new Set([1, 2, 3])) { n += v; if (v === 2) table[0](does, x); } } catch (e) { n = -n; } return r.lo + " " + r.hi + " " + n; }
function manyAlive(x: number, does: boolean): string {
  const r = record(x), s = record(x + 1), t = mixed(x + 2), [u, v] = pair(x + 3); let got = 0;
  try { got = table[0](does, x); } catch (e) { got = -1; }
  return [r.lo, r.hi, s.lo, s.hi, t.flag, t.count, t.name, t.held ? t.held.id : "null", u, v, got].join(" ");
}
function behindTheTryLate(x: number, does: boolean): string { const r = lateRecord(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r.lo + " " + r.hi + " " + got; }
function inTheHandlerLate(x: number, does: boolean): string { const r = lateRecord(x); try { table[0](does, x); return "none"; } catch (e) { return r.lo + " " + r.hi; } }
function inTheFinallyLate(x: number, does: boolean): string { const r = lateRecord(x); let text = ""; try { try { table[0](does, x); } finally { text = r.lo + " " + r.hi; } } catch (e) { text += " caught"; } return text; }
function ofAnArrayLate(x: number, does: boolean): string { const [p, q] = latePair(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return p + " " + q + " " + got; }
function ofAnArrayReadLaterLate(x: number, does: boolean): string { const r = latePair(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r[0] + " " + r[1] + " " + got; }
function ofEveryKindLate(x: number, does: boolean): string { const r = lateMixed(x); let got = 0; try { got = table[0](does, x); } catch (e) { got = -1; } return r.flag + " " + r.count + " " + r.name + " " + (r.held ? r.held.id : "null") + " " + got; }
function inTheTryAheadOfWhatThrowsLate(x: number, does: boolean): string { let lo = -1, hi = -1; try { const r = lateRecord(x); lo = r.lo; table[0](does, x); hi = r.hi; } catch (e) { hi = -2; } return lo + " " + hi; }
function twoHandlersLate(x: number, first: boolean, second: boolean): string { const r = lateRecord(x); const s = lateMixed(x + 1); let text = ""; try { table[0](first, x); text += "a"; } catch (e) { text += r.lo; } try { table[0](second, x); text += "b"; } catch (e) { text += s.name; } return text + " " + r.hi + " " + s.count; }
function inALoopLate(x: number): string { let text = ""; for (let i = 0; i < 4; i++) { const r = lateRecord(x + i); try { table[0]((i & 1) === 1, i); } catch (e) { text += "!"; } text += r.lo + "," + r.hi + ";"; } return text; }
function overAnIterationLate(x: number, does: boolean): string { const r = lateRecord(x); let n = 0; try { for (const v of new Set([1, 2, 3])) { n += v; if (v === 2) table[0](does, x); } } catch (e) { n = -n; } return r.lo + " " + r.hi + " " + n; }
function manyAliveLate(x: number, does: boolean): string {
  const r = lateRecord(x), s = lateRecord(x + 1), t = lateMixed(x + 2), [u, v] = latePair(x + 3); let got = 0;
  try { got = table[0](does, x); } catch (e) { got = -1; }
  return [r.lo, r.hi, s.lo, s.hi, t.flag, t.count, t.name, t.held ? t.held.id : "null", u, v, got].join(" ");
}
for (const does of [false, true]) {
  const how = does ? "it throws: " : "it does not: ";
  block("behind the try", () => { said.push("behind the try, " + how + behindTheTry(3, does) + " | " + behindTheTry(4, does)); });
  block("in the handler", () => { said.push("in the handler, " + how + inTheHandler(3, does)); });
  block("in the finally", () => { said.push("in the finally, " + how + inTheFinally(3, does)); });
  block("of an array", () => { said.push("of an array, " + how + ofAnArray(5, does)); });
  block("of an array read later", () => { said.push("of an array read later, " + how + ofAnArrayReadLater(5, does)); });
  block("of every kind", () => { said.push("of every kind, " + how + ofEveryKind(5, does) + " | " + ofEveryKind(6, does)); });
  block("in the try ahead of what throws", () => { said.push("in the try ahead of what throws, " + how + inTheTryAheadOfWhatThrows(7, does)); });
  block("two handlers", () => { said.push("two handlers, " + how + twoHandlers(2, does, !does) + " | " + twoHandlers(2, does, does)); });
  block("over an iteration", () => { said.push("over an iteration, " + how + overAnIteration(9, does)); });
  block("many alive", () => { said.push("many alive, " + how + manyAlive(1, does)); });
}
block("in a loop", () => { said.push("in a loop: " + inALoop(2)); });
for (const does of [false, true]) {
  const how = does ? "it throws: " : "it does not: ";
  block("late: behind the try", () => { said.push("late: behind the try, " + how + behindTheTryLate(3, does) + " | " + behindTheTryLate(4, does)); });
  block("late: in the handler", () => { said.push("late: in the handler, " + how + inTheHandlerLate(3, does)); });
  block("late: in the finally", () => { said.push("late: in the finally, " + how + inTheFinallyLate(3, does)); });
  block("late: of an array", () => { said.push("late: of an array, " + how + ofAnArrayLate(5, does)); });
  block("late: of an array read later", () => { said.push("late: of an array read later, " + how + ofAnArrayReadLaterLate(5, does)); });
  block("late: of every kind", () => { said.push("late: of every kind, " + how + ofEveryKindLate(5, does) + " | " + ofEveryKindLate(6, does)); });
  block("late: in the try ahead of what throws", () => { said.push("late: in the try ahead of what throws, " + how + inTheTryAheadOfWhatThrowsLate(7, does)); });
  block("late: two handlers", () => { said.push("late: two handlers, " + how + twoHandlersLate(2, does, !does) + " | " + twoHandlersLate(2, does, does)); });
  block("late: over an iteration", () => { said.push("late: over an iteration, " + how + overAnIterationLate(9, does)); });
  block("late: many alive", () => { said.push("late: many alive, " + how + manyAliveLate(1, does)); });
}
block("late: in a loop", () => { said.push("late: in a loop: " + inALoopLate(2)); });
console.log(said.join("\n"));
export {};
