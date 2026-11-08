let work = 0;
function alpha() { for (let i = 0; i < 2; i++) work = (work + i) | 0; }
function beta() { for (let i = 0; i < 2; i++) work = (work + i) | 0; }
function build(flag) { for (let i = 0; i < 2; i++) work = (work + i) | 0; const maker = flag ? alpha : beta; return new maker(); }
let out = "";
for (let i = 0; i < 300; i++) { const made = build(i % 2 === 0); out = typeof made + ":" + (made === undefined) + ":" + (made instanceof alpha || made instanceof beta); }
console.log(out);
