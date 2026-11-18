// Inside a try the handler sees the local, so narrowing it begins a new block: both sides of the test must still be reached from there.
class Ok { readonly ok = true; constructor(readonly value: number) {} }
class Err { readonly ok = false; constructor(readonly error: string) {} }
type Result = Ok | Err | undefined | null;
function make(n: number): Result { return n % 4 === 0 ? new Ok(n) : n % 4 === 1 ? new Err("e" + n) : n % 4 === 2 ? undefined : null; }
function asserted(x: Result): string {
  try { if (x!.ok) return "T" + (x as Ok).value; return "F" + (x as Err).error; } catch (e) { return "E" + (x === undefined ? "u" : "n"); }
}
function negated(x: Result): string {
  try { if (!x!.ok) return "f" + (x as Err).error; return "t" + (x as Ok).value; } catch (e) { return "e" + (e as Error).constructor.name; } finally { seen++; }
}
function looped(x: Result): string {
  let out = "";
  for (let i = 0; i < 2; i++) { try { out += x!.ok ? "y" : "n"; if (x!.ok && i) out += (x as Ok).value; } catch { out += "!"; } }
  return out;
}
let seen = 0;
let out = "";
for (let i = 0; i < 8; i++) { const x = make(i); out += asserted(x) + negated(x) + looped(x) + ";"; }
console.log(out, seen);
