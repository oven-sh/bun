// the subject of a switch is a call, and its cases are calls: each runs once, in the order written, up to the one that matches, though every case comes to one place
let log = "";
function note<T>(name: string, value: T) { log += name + ";"; return value; }
function subject(v: number) { switch (note("subject", v)) { case note("a", 1): break; case note("b", 2): break; case note("c", 3): break; } return log; }
function constant(o: { readonly kind: number }) { switch (o.kind) { case 1: break; case 2: break; } return log; }
function deed(v: number) { log = ""; const first = subject(v); log = ""; return first + "|" + constant({ get kind() { log += "read;"; return v; } }); }
for (let v = 0; v < 5; v++) console.log(deed(v));
let text = "";
for (let i = 0; i < 6; i++) text += deed(i & 3) + " ";
console.log(text);
