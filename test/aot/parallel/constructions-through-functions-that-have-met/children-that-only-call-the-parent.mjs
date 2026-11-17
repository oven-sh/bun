let work = 0;
function Parent() { for (let i = 0; i < 2; i++) work = (work + i) | 0; this.kind = "made"; }
function ChildA() { for (let i = 0; i < 2; i++) work = (work + i) | 0; Parent.call(this); }
function ChildB() { for (let i = 0; i < 2; i++) work = (work + i) | 0; Parent.call(this); }
function build(flag) { for (let i = 0; i < 2; i++) work = (work + i) | 0; const Maker = flag ? ChildA : ChildB; return new Maker(); }
let out = "";
for (let i = 0; i < 300; i++) { const made = build(i % 2 === 0); out = typeof made + ":" + made.kind; }
console.log(out);
