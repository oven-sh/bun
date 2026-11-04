// an object is frozen where it is made, and a handler further down hands it out and returns
type Failure = { code: number; msg: string };
let last: Failure | undefined;
function keep(e: Failure) { last = e; return -1; }
function subject(code: number, msg: string, risky: () => void) { const e: Failure = { code, msg }; Object.freeze(e); try { risky(); } catch { return keep(e); } return e.code; }
function fails() { throw new Error("no"); }
function passes() { }
function deed(code: number, risky: () => void) { last = undefined; const answer = subject(code, "m", risky); return answer + " " + (last ? String(Object.isFrozen(last)) + last.code : "none"); }
console.log(deed(1, passes), deed(1, fails));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i, i % 2 ? fails : passes);
console.log(text);
console.log(deed(7, fails));
