// A constant assigned inside `try` is an argument of the handler edge, so its code is emitted in the landing pad.
// JSON.parse throws from native code, so the exception is still pending in the VM when control reaches the pad.
function bigintConstant(text: string) { let n = 1n; try { n = 2n; JSON.parse(text); n = 3n; } catch {} return n; }
function stringConstant(text: string) { let s = "before"; try { s = "inside"; JSON.parse(text); s = "after"; } catch {} return s; }
function symbolConstant(text: string) { let s: symbol = Symbol.iterator; try { s = Symbol.asyncIterator; JSON.parse(text); s = Symbol.hasInstance; } catch {} return s.toString(); }
function builtinConstant(text: string) { let f: (x: number) => number = Math.abs; try { f = Math.floor; JSON.parse(text); f = Math.ceil; } catch {} return f(-1.5); }
function readsCaughtValue(text: string) { let n = 1n; let name = "none"; try { n = 2n; JSON.parse(text); n = 3n; } catch (e) { name = (e as Error).name; } return name + " " + n; }
function throughFinally(text: string) { let n = 1n; const seen: bigint[] = []; try { try { n = 2n; JSON.parse(text); n = 3n; } finally { seen.push(n); } } catch (e) { return (e as Error).name + " " + seen.join(); } return "none " + seen.join(); }
function thrownByCompiledCode(fail: boolean) { let n = 1n; try { n = 2n; if (fail) throw new RangeError("compiled"); n = 3n; } catch {} return n; }
function severalSites(first: string, second: string) { let n = 1n; let s = "a"; try { n = 2n; JSON.parse(first); s = "b"; JSON.parse(second); n = 3n; } catch {} return s + n; }
for (const text of ["{", "{}"]) {
  console.log(bigintConstant(text), stringConstant(text), symbolConstant(text), builtinConstant(text), readsCaughtValue(text), throughFinally(text), thrownByCompiledCode(text === "{"));
  console.log(severalSites(text, "{}"), severalSites("{}", text));
}

export {};
