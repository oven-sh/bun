let work = 0;
function alpha() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7; }
function beta() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return 9; }
const tell = (made) => typeof made + ":" + (made instanceof alpha) + ":" + (made instanceof beta);
const makers = [alpha, beta];
function build(at) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return new makers[at](); }
let out = "";
for (let i = 0; i < 300; i++) out = tell(build(i % 2));
console.log(out);
