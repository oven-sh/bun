function id(x) { return x; }
const got = [id(null), id({ a: 1 }), id(undefined), id({ b: 2 }), id(), id(0), id("")];
console.log(got.map(each => (each == null ? String(each) : typeof each === "object" ? Object.keys(each)[0] : typeof each)).join());
