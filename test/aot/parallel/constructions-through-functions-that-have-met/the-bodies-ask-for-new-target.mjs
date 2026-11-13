let work = 0;
let seen = "";
function alpha() { for (let i = 0; i < 2; i++) work = (work + i) | 0; seen = (new.target === alpha) + ":" + (new.target === undefined); }
function beta() { for (let i = 0; i < 2; i++) work = (work + i) | 0; seen = (new.target === beta) + ":" + (new.target === undefined); }
function build(flag, constructs) { for (let i = 0; i < 2; i++) work = (work + i) | 0; const maker = flag ? alpha : beta; return constructs ? new maker() : maker(); }
let out = "";
for (let i = 0; i < 300; i++) { const made = build(i % 2 === 0, true); out = seen + " " + typeof made; const plain = build(i % 2 === 0, false); out += " " + seen + " " + typeof plain; }
console.log(out);
