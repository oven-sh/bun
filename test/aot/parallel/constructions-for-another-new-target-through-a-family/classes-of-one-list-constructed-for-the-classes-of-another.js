let work = 0;
function withCount(Base) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return class extends Base { count() { return 1; } }; }
const below = [], beside = [], bases = [];
function step0() { for (let i = 0; i < 2; i++) work = (work + i) | 0; class Base { kind() { return 0; } } bases.push(Base); below.push(class extends withCount(Base) {}); beside.push(class extends Base { own() { return 10; } }); }
function step1() { for (let i = 0; i < 2; i++) work = (work + i) | 0; class Base { kind() { return 1; } } bases.push(Base); below.push(class extends withCount(Base) {}); beside.push(class extends Base { own() { return 11; } }); }
function step2() { for (let i = 0; i < 2; i++) work = (work + i) | 0; class Base { kind() { return 2; } } bases.push(Base); below.push(class extends withCount(Base) {}); beside.push(class extends Base { own() { return 12; } }); }
step0(); step1(); step2();
function build(at, other) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return Reflect.construct(below[at], [], beside[other]); }
let out = "";
for (let turn = 0; turn < 300; turn++) { const at = turn % 3, other = (turn + 1) % 3; const made = build(at, other); out = [made instanceof bases[at], made instanceof bases[other], made instanceof beside[other], made.kind(), made.own(), typeof made.count].join(":"); }
console.log(out);
