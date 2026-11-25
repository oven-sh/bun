function Pair(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.first = seed;
  var never;
  let self = null;
  if (never !== 1) self = this;
  const had = "second" in self;
  this.second = seed + work;
  this.had = had;
}
let last = "";
for (let i = 0; i < 300; i++) {
  const pair = new Pair(i);
  last = String(pair.had) + " " + pair.second;
}
console.log(last);
