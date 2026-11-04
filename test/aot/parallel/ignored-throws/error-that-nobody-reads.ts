// an error is made and thrown under a catch that has no binding: nobody can tell whether it was made
function subject(bad: unknown) { try { if (bad) throw new Error("bad"); return "fine"; } catch { return "caught"; } }
function deed(bad: unknown) { return subject(bad); }
console.log(deed(false));
console.log(deed(true));
let text = "";
for (let i = 0; i < 6; i++) text += deed(i & 1) + ";";
console.log(text);
console.log(deed("x"));
