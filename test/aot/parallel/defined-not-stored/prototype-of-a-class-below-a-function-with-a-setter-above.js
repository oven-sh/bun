function Above() {}
Object.setPrototypeOf(Above, { set prototype(value) { console.log("the setter ran"); } });
class Below extends Above {}
console.log(Object.hasOwn(Below, "prototype"), Object.getPrototypeOf(Below.prototype) === Above.prototype, new Below() instanceof Above);
