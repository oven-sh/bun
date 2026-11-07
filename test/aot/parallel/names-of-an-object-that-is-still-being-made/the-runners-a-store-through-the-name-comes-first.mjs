function Pair(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.first = seed;
  var never;
  let self = null;
  if (never !== 1) self = this;
  self.second = seed;
  this.second = seed + work;
  this.third = work;
}
let last = "";
for (let i = 0; i < 300; i++) last = Object.keys(new Pair(i)).join();
console.log(last);
