// the program sets Error.stackTraceLimit and takes traces by Error.captureStackTrace around errors that nobody reads: the limit and the objects are as the program left them
function subject(bad: unknown) { try { if (bad) throw new Error("bad"); return "fine"; } catch { return "caught"; } }
function marked(bad: unknown, holder: object) { try { if (bad) { Error.captureStackTrace(holder); throw holder; } return "fine"; } catch { return "caught" + String("stack" in holder); } }
function deed(bad: unknown) { const holder = {}; return subject(bad) + marked(bad, holder) + String("stack" in holder) + String(Error.stackTraceLimit); }
console.log(deed(false));
console.log(deed(true));
Error.stackTraceLimit = 0;
console.log(deed(true));
Error.stackTraceLimit = 3;
let text = "";
for (let i = 0; i < 4; i++) text += deed(i & 1) + ";";
console.log(text);
