// what is thrown at a catch that ignores it is made by a constructor of the program, which counts and keeps each object that it makes
const made: MyError[] = [];
class MyError extends Error { code: number; constructor(message: string, code: number) { super(message); this.code = code; made.push(this); } }
function subject(bad: unknown) { try { if (bad) throw new MyError("bad", made.length); return "fine"; } catch { return "caught" + made.length; } }
function deed(bad: unknown) { return subject(bad); }
console.log(deed(false));
console.log(deed(true));
let text = "";
for (let i = 0; i < 6; i++) text += deed(i & 1) + ";";
console.log(text);
console.log(String(made.length) + made[2].message + made[2].code + String(made[0] === made[1]));
