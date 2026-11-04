// the side of a branch that throws hands out an object into which the code in front of the branch has stored
type Failure = { code: number; msg: string; more?: string };
function wrap(e: Failure) { return new Error(JSON.stringify(e) + " " + Object.keys(e).join()); }
function subject(code: number, msg: string, bad: unknown) { const e: Failure = { code, msg }; e.code = code * 2; e.more = msg + "!"; if (bad) throw wrap(e); return e.code + e.more; }
function deed(code: number, bad: unknown) { try { return subject(code, "m", bad); } catch (e) { return (e as Error).message; } }
console.log(deed(1, false));
console.log(deed(1, true));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i, i % 7 === 0);
console.log(text);
console.log(deed(294, JSON.parse("1")));
