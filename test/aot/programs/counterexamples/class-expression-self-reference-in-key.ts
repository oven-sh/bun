// A class expression that names itself stands in the computed key of a method.
class B { [(class K { g() { K; } }).name]() {} }
console.log("K" in B.prototype);
