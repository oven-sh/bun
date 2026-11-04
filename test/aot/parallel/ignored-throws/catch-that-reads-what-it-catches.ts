// the catch reads the message, the name and the identity of what was thrown under it
const kept: unknown[] = [];
function subject(bad: unknown) { try { if (bad) throw new RangeError("bad" + String(bad)); return "fine"; } catch (e) { kept.push(e); return (e as Error).name + (e as Error).message + String(e instanceof RangeError); } }
function deed(bad: unknown) { return subject(bad); }
console.log(deed(0));
console.log(deed(1));
let text = "";
for (let i = 0; i < 4; i++) text += deed(i) + ";";
console.log(text);
console.log(String(kept.length) + String(kept[0] === kept[1]) + (kept[3] as Error).message);
