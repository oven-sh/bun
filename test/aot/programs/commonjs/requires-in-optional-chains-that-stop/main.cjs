// Requires in optional chains that stop.
const no = globalThis.nothingHere;
no?.x(require("./x.cjs"));
no?.x.y.z(require("./x.cjs"));
no?.x[require("./x.cjs")];
no?.x.y(1)[2](require("./x.cjs").v);
console.log("none ran");
console.log(require("./y.cjs").seen);
