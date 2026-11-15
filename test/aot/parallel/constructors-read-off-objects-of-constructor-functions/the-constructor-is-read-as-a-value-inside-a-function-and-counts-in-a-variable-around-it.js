const turns = +process.argv[2] || 200;
var Bare = (function (step) { function Bare(n) { this.n = n + step; } return Bare; }(turns & 1));
function ask(i) { return new Bare(i).constructor === Bare; }
let same = 0;
for (let i = 0; i < turns; i++) if (ask(i)) same++;
console.log(same, new (new Bare(1).constructor)(2).n);
