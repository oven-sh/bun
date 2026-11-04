// one side of a branch hands an object to a function that keeps it, and then throws the object itself
type Failure = { code: number; msg: string };
let last: Failure | undefined;
function keep(e: Failure) { last = e; }
function subject(code: number, msg: string, bad: unknown) { const e: Failure = { code, msg }; if (bad) { keep(e); throw e; } return e.code; }
function deed(code: number, bad: unknown) { last = undefined; try { return String(subject(code, "m", bad)); } catch (e) { return String(e === last) + " " + (e as Failure).code; } }
console.log(deed(1, false), deed(1, true));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i, i % 2);
console.log(text);
console.log(deed(7, JSON.parse("1")));
