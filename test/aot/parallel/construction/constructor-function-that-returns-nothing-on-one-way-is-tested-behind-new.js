// a constructor function returns undefined on one way, false on another and an object on a third, and what `new` gives is tested at once
function Made(x) { if (x === 1) return; if (x === 2) return false; if (x === 3) return { other: true }; this.a = x; }
function subject(x) { if (new Made(x)) return "object"; return "nothing"; }
function read(x) { const made = new Made(x); if (made.other) return "other"; return made instanceof Made ? "made" + String(made.a) : "lost"; }
function deed(x) { return subject(x) + ":" + read(x); }
console.log(deed(0), deed(1), deed(2), deed(3), deed(4));
let objects = 0;
for (let i = 0; i < 300; i++) objects += subject(i % 5) === "object" ? 1 : 0;
console.log(String(objects));
console.log(deed(JSON.parse("1")), deed(JSON.parse("3")));
