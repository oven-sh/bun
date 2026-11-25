// A constructor that passes its arguments on is copied however much its caller has copied: no array is made of the arguments.
// STATISTIC: OperationsSwept <= 620
var Shop = {};
Shop.cast = function () {
  return function () {
    this.knead.apply(this, arguments);
  };
};
Shop.Peg = Shop.cast();
Shop.Peg.prototype = {
  knead: function (x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  },
};
Shop.Label = Shop.cast();
Shop.Label.prototype = {
  knead: function (text) {
    this.text = text;
  },
};
function first(v, a) {
  let s = a * 0.5 + v.x;
  s = s * 0.25 - v.y;
  s = s * 0.35 - v.z;
  s = s * 0.45 - v.x;
  return second(v, s);
}
function second(v, a) {
  let s = a * 0.5 + v.x;
  s = s * 0.25 - v.y;
  s = s * 0.35 - v.z;
  s = s * 0.45 - v.x;
  return third(v, s);
}
function third(v, a) {
  let s = a * 0.5 + v.x;
  s = s * 0.25 - v.y;
  s = s * 0.35 - v.z;
  s = s * 0.45 - v.x;
  return fourth(v, s);
}
function fourth(v, a) {
  let s = a * 0.5 + v.x;
  s = s * 0.25 - v.y;
  s = s * 0.35 - v.z;
  s = s * 0.45 - v.x;
  return fifth(v, s);
}
function fifth(v, a) {
  let s = a * 0.5 + v.x;
  s = s * 0.25 - v.y;
  s = s * 0.35 - v.z;
  s = s * 0.45 - v.x;
  s = s * 0.35 - v.x;
  s = s * 0.45 - v.x;
  s = s * 0.55 - v.x;
  s = s * 0.65 - v.x;
  return sixth(v, s);
}
function sixth(v, a) {
  return new Shop.Peg(a, v.y, v.z);
}
const kept = [];
function run(count) {
  let total = 0;
  const from = new Shop.Peg(0.125, 0.5, 0.25);
  for (let index = 0; index < count; index++) {
    const made = first(from, index);
    kept[index & 1] = made;
    total += made.x;
  }
  return total;
}
const sum = run(20).toFixed(6), names = kept.map(v => Object.keys(v).join());
console.log(sum, new Shop.Label("a").text, names.length ? names.join(" ") : "");
