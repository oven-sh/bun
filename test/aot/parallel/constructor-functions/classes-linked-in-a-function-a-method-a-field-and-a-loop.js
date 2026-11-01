// The same link at the top level, in a function that runs once, in one that runs twice, in a method, in a field and in a loop.
function Base(size) {
  this.size = size;
}
Base.prototype.twice = function () {
  return this.size * 2;
};
function link(size) {
  function Derived() {}
  Derived.prototype = new Base(size);
  Derived.prototype.more = function () {
    return this.twice() + 1;
  };
  return Derived;
}
const Once = (function () {
  function Derived() {}
  Derived.prototype = new Base(1);
  return Derived;
})();
const holder = {
  link(size) {
    function Derived() {}
    Derived.prototype = new Base(size);
    return Derived;
  },
};
class WithField {
  Linked = (() => {
    function Derived() {}
    Derived.prototype = new Base(6);
    return Derived;
  })();
}
const inLoop = [];
for (let i = 0; i < 3; i++) {
  function Derived() {}
  Derived.prototype = new Base(10 + i);
  inLoop.push(Derived);
}
const Two = link(2), Three = link(3);
console.log(new Once().twice(), new Two().more(), new Three().more(), Two.prototype === Three.prototype, new (holder.link(4))().twice(), new (new WithField().Linked)().twice());
console.log(inLoop.map(Linked => new Linked().twice()).join(), inLoop[0].prototype === inLoop[1].prototype, new Base(9).twice());
