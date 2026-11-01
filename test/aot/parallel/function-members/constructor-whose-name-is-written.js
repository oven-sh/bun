function K() {
  this.a = 1;
}
K.prototype.m = function () {
  return this.a;
};
K.n = 1;
const old = K;
K = function () {};
K.n = 2;
console.log(old.n, K.n, new old().m(), Object.keys(old), Object.keys(K));
