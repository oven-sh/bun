const above = { set constructor(value) { console.log("the setter ran"); } };
function Plain() {}
console.log(Plain.prototype.constructor === Plain);
Object.setPrototypeOf(Plain.prototype, above);
console.log(new Plain().constructor === Plain, Object.hasOwn(Plain.prototype, "constructor"));
