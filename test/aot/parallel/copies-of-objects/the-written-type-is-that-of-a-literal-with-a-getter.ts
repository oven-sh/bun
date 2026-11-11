let log = "";
function make(n: number) { return { a: n, get b() { log += " get" + n; return n * 2; }, c: n + 1 }; }
type Source = ReturnType<typeof make>;
function show(o: any): string { let text = ""; for (const key of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, key)!; text += key + "=" + ("value" in d ? d.value : "accessor") + " "; } const all = text + log; log = ""; return all; }
function behind(s: Source, k: number) { return { ...s, z: k }; }
function inFront(s: Source, k: number) { return { z: k, ...s }; }
function alone(s: Source) { return { ...s }; }
function assigned(s: Source, k: number) { return Object.assign({ z: k }, s); }
function rest(s: Source) { const { a, ...others } = s; return others; }
const kept = [make(1), make(2)];
(globalThis as any).kept = kept;
for (let k = 0; k < 3; k++) for (const s of kept) console.log(show(behind(s, k)), "|", show(inFront(s, k)), "|", show(alone(s)), "|", show(assigned(s, k)), "|", show(rest(s)));
