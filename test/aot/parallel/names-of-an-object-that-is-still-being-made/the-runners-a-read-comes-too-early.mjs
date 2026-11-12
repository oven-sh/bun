function Pair(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.first = seed;
  var never;
  let self = null;
  if (never !== 1) self = this;
  const kind = typeof self.second;
  this.second = seed + work;
  this.kind = kind;
}
let last = "";
for (let i = 0; i < 300; i++) {
  const pair = new Pair(i);
  last = pair.kind + " " + pair.second;
}
console.log(last);
