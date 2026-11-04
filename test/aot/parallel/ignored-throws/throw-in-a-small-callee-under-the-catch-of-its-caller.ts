// a small function throws, and its caller catches without a binding. Another caller reads what the same function throws
function fail(code: number): never { throw new RangeError("code" + code); }
function check(code: number) { if (code > 1) fail(code); return code; }
function ignores(code: number) { try { return "fine" + check(code); } catch { return "caught"; } }
function reads(code: number) { try { return "fine" + check(code); } catch (e) { return (e as Error).message; } }
function deed(code: number) { return ignores(code) + " " + reads(code); }
console.log(deed(0));
console.log(deed(2));
let text = "";
for (let i = 0; i < 5; i++) text += deed(i) + ";";
console.log(text);
