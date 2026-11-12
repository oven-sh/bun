// Math.max(1, Symbol()), [Symbol()].map(Math.abs): where the call of a built-in is made in line its operands are converted in front of it. A conversion that throws, or that runs code of the program, lists the frame of the built-in,
// and where the call is written in tail position the function that left is not listed.
const frames = e => String(e.stack).split("\n").slice(1).map(l => { const m = /^\s*at (?:async )?([^\s(]+) \(/.exec(l); return m ? m[1] : "<anonymous>"; }).slice(0, 4).join(" < ");
function looped() { let s = ""; for (let i = 0; i < 3; i++) { try { [1, Symbol("s")].reduce(Math.max); } catch (e) { s = e.name + " " + frames(e); } } return s; }
function once() { try { [1, Symbol("s")].reduce(Math.max); } catch (e) { return e.name + " " + frames(e); } }
function direct() { try { return Math.max(1, Symbol("s")); } catch (e) { return e.name + " " + frames(e); } }
function mapped() { let s = ""; for (let i = 0; i < 3; i++) { try { [Symbol("s")].map(Math.abs); } catch (e) { s = e.name + " " + frames(e); } } return s; }
function floored() { let s = ""; for (let i = 0; i < 3; i++) { try { [Symbol("s")].map(Math.floor); } catch (e) { s = e.name + " " + frames(e); } } return s; }
function seen() { let s = ""; Math.max(1, { valueOf() { s = frames(new Error("x")); return 2; } }); return s; }
function padded() { try { return "a".padStart(3, Symbol("s")); } catch (e) { return e.name + " " + frames(e); } }
function repeated() { try { return "a".repeat(Symbol("s")); } catch (e) { return e.name + " " + frames(e); } }
function joined() { let s = ""; [1, 2].join({ toString() { s = frames(new Error("x")); return "-"; } }); return s; }
function powered() { try { return Math.pow(2n, 2); } catch (e) { return e.name + " " + frames(e); } }
function charAt() { let s = ""; "abc".charAt({ valueOf() { s = frames(new Error("x")); return 1; } }); return s; }
function leavesByFloor(x) { "use strict"; return Math.floor(x); }
function left() { let s = ""; leavesByFloor({ valueOf() { s = frames(new Error("x")); return 1; } }); try { leavesByFloor(Symbol("s")); } catch (e) { s += " | " + frames(e); } return s; }
for (const f of [looped, once, direct, mapped, floored, seen, padded, repeated, joined, powered, charAt, left]) console.log(f.name, f());
