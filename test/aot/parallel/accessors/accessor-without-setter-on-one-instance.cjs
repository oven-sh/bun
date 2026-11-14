// The constructor of the next instance must not throw for a name that one instance holds as a getter alone.
function M() {
  this.a = 1;
  this.c = 2;
}
M.prototype.run = function () {
  return this.c;
};
const h = new M();
Object.defineProperty(h, "c", { configurable: true, enumerable: true, get() { return 4; } });
console.log(h.c, Object.keys(h).join(), new M().c, Object.keys(new M()).join(), new M().run());
