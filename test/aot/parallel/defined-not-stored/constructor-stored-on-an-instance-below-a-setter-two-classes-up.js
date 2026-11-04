class OnlySetter { set ["constructor"](value) { console.log("the setter ran"); } }
class Below extends OnlySetter {}
const made = new Below();
made.constructor = "stored";
console.log(made.constructor, Object.hasOwn(made, "constructor"));
const above = new OnlySetter();
above.constructor = "stored";
console.log(above.constructor, Object.hasOwn(above, "constructor"));
