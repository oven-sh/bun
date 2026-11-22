function below(kind) { let top = Object; if (kind) top = kind.top; class Below extends top {} return Below; }
const D = below({ top: Error }); Object.getPrototypeOf(D).made = 1; Object.getPrototypeOf(D.prototype).laid = function () { return "up"; }; console.log(Error.made, TypeError.made, D.made, new RangeError("y").laid());
