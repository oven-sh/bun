// a handler hands out an object that was made in front of the try, and the code behind the handler stores into it and compares it
type Failure = { code: number; msg: string };
let last: Failure | undefined;
function keep(e: Failure) { last = e; }
function subject(code: number, msg: string, risky: () => void) { const e: Failure = { code, msg }; try { risky(); } catch { keep(e); } e.code = code + 1; return e; }
function fails() { throw new Error("no"); }
function passes() { }
function deed(code: number, risky: () => void) { last = undefined; const e = subject(code, "m", risky); return String(last === e) + " " + (last ? last.code : "none") + " " + e.code; }
console.log(deed(1, passes), deed(1, fails));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i, i % 2 ? fails : passes) + " | " + text.slice(0, 20);
console.log(text);
console.log(deed(7, fails), deed(7, passes));
