function Pair(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.first = seed;
  var never;
  let self = null;
  if (never !== 1) self = this;
  const { second = "none" } = self;
  this.second = seed + work;
  this.seen = second;
}
let last = "";
for (let i = 0; i < 300; i++) {
  const made = new Pair(i);
  last = made.seen + " " + made.second;
}
console.log(last);
console.log((0, eval)("1 + 1"));
