let work = 0;
class Shape { constructor() { for (let i = 0; i < 2; i++) work = (work + i) | 0; this.first = new.target.name; } }
class Circle extends Shape { constructor() { super(); for (let i = 0; i < 2; i++) work = (work + i) | 0; this.madeFor = new.target.name; } }
class Square extends Shape { constructor() { super(); for (let i = 0; i < 2; i++) work = (work + i) | 0; this.madeFor = new.target.name + "!"; } }
const parents = [Circle, Square];
function below(at) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return class Below extends parents[at] { constructor() { super(); this.own = 1; } }; }
const made = [below(0), below(1)];
let out = "";
for (let turn = 0; turn < 300; turn++) { const one = new made[turn % 2](); out = [one.first, one.madeFor, one.own, one instanceof Circle, one instanceof Square].join(":"); }
console.log(out);
