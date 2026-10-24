// The discriminant of a union is read before a `try` and compared after the `catch`.
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => string) { try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + String(error)); } }
type A = { kind: "a"; x: number }; type B = { kind: "b"; y: string }; type C = { kind: "c"; z: boolean }; type U = A | B | C;
function check(n: number): void { if (n > 3) throw "no"; }
function deep(n: number, depth: number): number { let a = n + 1, b = n + 2, c = n + 3, d = n + 4, e = n + 5, f = n + 6, g = n + 7, h = n + 8; for (let t = 0; t < 2; t++) { a += b ^ t; b += c & 31; c += d | 1; d += e ^ a; e += f & b; f += g | c; g += h ^ d; h += a & e; } if (depth) return deep(a & 63, depth - 1) + b + c + d + e + f + g + h; if (n >= 0) throw "deep"; return a; }
function behindTheTry(u: U, n: number): string { const k = u.kind; let caught = 0; try { check(n); } catch (e) { caught = 1; } return (k === "a" ? "A" : k === "b" ? "B" : "C") + caught; }
function thrownInPlace(u: U, n: number): string { const k = u.kind; let caught = 0; try { if (n > 3) throw "no"; } catch (e) { caught = 1; } return (k === "a" ? "A" : k === "b" ? "B" : "C") + caught; }
function inTheHandler(u: U, n: number): string { const k = u.kind; try { check(n); return "none"; } catch (e) { return k === "b" ? "B" : "not B"; } }
function inALoop(us: U[], n: number): string { let text = ""; for (let i = 0; i < us.length; i++) { const k = us[i].kind; try { check(n + i); } catch (e) { text += "!"; } text += k === "a" ? "A" : k === "b" ? "B" : "C"; } return text; }
function threeFramesDown(u: U, n: number): string { const k = u.kind; let caught = 0; try { if (n > 3) deep(n, 3); } catch (e) { caught = 1; } return (k === "c" ? "C" : "not C") + caught; }
function bySwitch(u: U, n: number): string { const k = u.kind; let caught = 0; try { check(n); } catch (e) { caught = 1; } switch (k) { case "a": return "A" + caught; case "b": return "B" + caught; default: return "C" + caught; } }
const a: U = { kind: "a", x: 1 }, b: U = { kind: "b", y: "s" }, c: U = { kind: "c", z: true };
const table = [behindTheTry, thrownInPlace, inTheHandler, threeFramesDown, bySwitch];
const names = ["behind the try", "thrown in place", "in the handler", "three frames down", "by a switch"];
for (const n of [1, 5]) {
  for (let i = 0; i < table.length; i++) block(names[i] + (n > 3 ? ", it throws" : ", it does not"), () => table[i](a, n) + " " + table[i](b, n) + " " + table[i](c, n));
  block("in a loop" + (n > 3 ? ", it throws" : ", some throw"), () => inALoop([a, b, c, b, a], n));
}
console.log(said.join("\n"));
export {};
