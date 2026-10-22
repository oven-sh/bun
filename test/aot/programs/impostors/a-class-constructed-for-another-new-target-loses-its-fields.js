class Stores {
  constructor() {
    this.sides = 4;
  }
}

class Initializes {
  sides = 5;
}

function OldStyle() {
  this.sides = 6;
}

class Other {}

function OtherOldStyle() {}

function describe(label, made, target) {
  console.log(
    label + ":",
    "sides",
    made.sides,
    "| keys",
    Object.keys(made).join(),
    "| prototype is the target's",
    Object.getPrototypeOf(made) === target.prototype,
  );
}

describe("a constructor that stores, for itself", Reflect.construct(Stores, [], Stores), Stores);
describe("a constructor that stores, for another class", Reflect.construct(Stores, [], Other), Other);
describe("a constructor that stores, for a function", Reflect.construct(Stores, [], OtherOldStyle), OtherOldStyle);
describe("a field initializer, for another class", Reflect.construct(Initializes, [], Other), Other);
describe("a field initializer, for a function", Reflect.construct(Initializes, [], OtherOldStyle), OtherOldStyle);
describe("a constructor function, for another class", Reflect.construct(OldStyle, [], Other), Other);
describe("a constructor function, for a function", Reflect.construct(OldStyle, [], OtherOldStyle), OtherOldStyle);
