let work = 0;
function alpha() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7; }
function beta() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 9; }
const tell = (made) => typeof made + ":" + (made instanceof alpha) + ":" + (made instanceof beta);
function build(maker) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return new maker(); }
let out = "";
for (let i = 0; i < 300; i++) out = tell(build(alpha)) + " " + tell(build(beta));
console.log(out);
