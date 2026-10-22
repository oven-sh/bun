// The one value is a real object: what is stored behind it under a name is found by every way to read a property.
const make = require("./function.cjs");
const Kind = require("./class.cjs");
function read(object, key) { return object[key]; }
function names(object) { return Object.keys(object).join(); }
console.log(make.version, read(make, "version"), names(make), make.helper(), make(2));
console.log(Kind.version, read(Kind, "version"), names(Kind), Kind.helper(), new Kind().size);
console.log(read(make, "unr" + "ead"), read(Kind, "unr" + "ead"));
Object.assign(make, { version: 5 });
Object.assign(Kind, { version: 6 });
console.log(make.version, make.own(), Kind.version, Kind.own());
make["ver" + "sion"] = 7;
Kind["ver" + "sion"] = 8;
console.log(make.version, make.own(), Kind.version, Kind.own());
delete make.version;
delete Kind.version;
console.log(make.version, make.own(), "version" in make, Kind.version, Kind.own(), "version" in Kind);
Object.defineProperty(make, "version", { get() { return "got"; }, configurable: true });
Object.defineProperty(Kind, "version", { get() { return "got"; }, configurable: true });
console.log(make.version, make.own(), Kind.version, Kind.own());
Object.freeze(make);
make.helper = 1;
console.log(typeof make.helper, Object.isFrozen(make));
