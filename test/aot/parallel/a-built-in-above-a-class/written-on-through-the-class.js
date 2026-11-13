function define(params) { const Parent = params?.Parent ?? Object; class Definition extends Parent {} return Definition; }
const D = define({ Parent: Error }); Object.getPrototypeOf(D).made = 1; Object.getPrototypeOf(D.prototype).laid = function () { return "up"; }; console.log(Error.made, TypeError.made, D.made, new RangeError("y").laid());
