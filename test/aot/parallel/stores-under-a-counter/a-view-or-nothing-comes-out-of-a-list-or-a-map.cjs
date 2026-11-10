// Under: --aot-testing=EmittersAloneTestEveryPosition: the walk as users build it, and every raw store asks its position at the run.
"use strict";
const buffer = new ArrayBuffer(256), all = new Uint8Array(buffer);
const bytes = [new Uint8Array(buffer, 16, 12), new Uint8Array(buffer, 48, 12)];
const floats = [new Float64Array(buffer, 96, 6), new Float64Array(buffer, 160, 6)];
const byName = new Map([["a", bytes[0]], ["b", bytes[1]]]);
const orNull = [bytes[0], null];
const seen = [];
function fillBytes(at, t, n) { const b = bytes[at]; for (let i = 0; i < n; i++) b[i] = i + t; return n; }
function fillFloats(at, t, n) { const b = floats[at]; for (let i = 0; i < n; i++) b[i] = i + t; return n; }
function fillNamed(name, t, n) { const b = byName.get(name); for (let i = 0; i < n; i++) b[i] = i + t; return n; }
function fillOrNull(at, t, n) { const b = orNull[at]; for (let i = 0; i < n; i++) b[i] = i + t; return n; }
function fillAndTell(at, t, n) { const b = bytes[at]; for (let i = 0; i < n; i++) b[i] = (seen.push(i), i + t); return n; }
function fillInTry(at, t, n) { const b = bytes[at]; let turns = 0; try { for (let i = 0; i < n; i++) { b[i] = i + t; turns++; } } catch (error) { return error.constructor.name + " behind " + turns; } return turns; }
function sumBytes(at, n) { const b = bytes[at]; let sum = 0; for (let i = 0; i < n; i++) sum += b[i]; return sum; }
function sumFloats(at, n) { const b = floats[at]; let sum = 0; for (let i = 0; i < n; i++) sum += b[i]; return sum; }
function attempt(name, run) { let said; try { said = String(run()); } catch (error) { said = error.constructor.name + ": " + error.message; } console.log(name, said, "|", all.join(), "|", seen.join()); seen.length = 0; }
for (let round = 0; round < 3; round++) {
  all.fill(200 + round);
  for (const at of [0, 1, 2, -1, 0.5]) {
    attempt("bytes " + at, () => fillBytes(at, 3, 14)); attempt("floats " + at, () => fillFloats(at, 0.5, 8)); attempt("told " + at, () => fillAndTell(at, 1, 3)); attempt("in a try " + at, () => fillInTry(at, 5, 14));
    attempt("no turn " + at, () => fillBytes(at, 3, 0)); attempt("the sum of bytes " + at, () => sumBytes(at, 14)); attempt("the sum of floats " + at, () => sumFloats(at, 8)); attempt("no turn of a sum " + at, () => sumBytes(at, 0));
  }
  for (const name of ["a", "b", "c"]) attempt("named " + name, () => fillNamed(name, 7, 14));
  for (const at of [0, 1, 2]) attempt("or null " + at, () => fillOrNull(at, 9, 14));
}
