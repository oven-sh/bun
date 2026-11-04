// `this instanceof Other` ahead of the stores, where a proxy stands above the object: the walk runs the trap, and the trap lays a setter under the name that the constructor stores next.
var walks = 0;
var caught = [];
var above = {};
function Other() {}
function Below(a) {
  this.wasOther = this instanceof Other;
  this.a = a;
}
Below.prototype = new Proxy(above, {
  getPrototypeOf(target) {
    if (++walks === 100) Object.defineProperty(above, "a", { set(value) { caught.push(value); }, configurable: true });
    return Object.getPrototypeOf(target);
  },
});
var own = 0;
for (var i = 0; i < 200; i++) own += Object.hasOwn(new Below(i), "a") ? 1 : 0;
console.log(own, walks, caught.length, caught[0], caught[caught.length - 1]);
