// A BigInt literal as a member name names the property whose name is its decimal digits. A getter of that name is a member, and a store to the same name runs into the getter and adds no field.
class A {
  get 99999999999999999999n() { return 1; }
  constructor() { this["99999999999999999999"] = 2; }
}
function F() { this["99999999999999999999"] = 1; }
F.prototype = { get 99999999999999999999n() { return 1; } };
