// a class below a class below Error: the super call of Error makes the object below what new.target selects, and a variable that the constructor reads on both sides of it stays as it was
let made = 0;
class E extends Error { code: number; constructor(m: string) { const before = made; super(m); made = before + 1; this.code = made; } }
class Below extends E { constructor() { super("below"); } }
function deed() { const e = new Below(); return e.message + " " + (e instanceof Below) + " " + (e instanceof E) + " " + (e instanceof Error) + " " + e.code; }
console.log(deed());
let all = "";
for (let i = 0; i < 4; i++) all += deed() + ";";
console.log(all);
console.log(new E("plain").code + " " + (new E("plain") instanceof Below));
