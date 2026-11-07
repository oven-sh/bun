class OnlySetter { set ["constructor"](value) {} }
class Below extends OnlySetter {}
console.log(Below.prototype.constructor === Below, OnlySetter.prototype.constructor, Object.getPrototypeOf(new Below()).constructor === Below);
