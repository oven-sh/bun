class Holder { ["constructor"] = "a field"; }
class Below extends Holder {}
console.log(new Holder().constructor, new Below().constructor, Object.hasOwn(new Below(), "constructor"), Below.prototype.constructor === Below);
