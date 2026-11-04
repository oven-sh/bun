class OnlySetter { set ["constructor"](value) { console.log("the setter ran"); } }
class Below extends OnlySetter {}
console.log(new Below().constructor === Below, new OnlySetter().constructor);
console.log(Object.getOwnPropertyDescriptor(Below.prototype, "constructor").value === Below);
