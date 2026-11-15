// the message of an error that nobody reads is an object: the constructor converts it, and its toString prints, counts, or throws
let log = "";
const printing = { toString() { log += "printed;"; return "text"; } };
const refusing = { toString(): string { log += "refused;"; throw new RangeError("no text"); } };
function subject(bad: unknown, message: unknown) { try { if (bad) throw new Error(message as string); return "fine"; } catch { return "caught"; } }
function deed(bad: unknown, message: unknown) { log = ""; return subject(bad, message) + ":" + log; }
console.log(deed(false, printing));
console.log(deed(true, printing));
console.log(deed(true, refusing));
console.log(deed(true, "plain"));
console.log(deed(true, Symbol("none")));
let text = "";
for (let i = 0; i < 4; i++) text += deed(i & 1, i > 1 ? printing : "plain") + "|";
console.log(text);
