var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

var Vehicle = (function () {
    function Vehicle(wheels) {
        this.wheels = wheels;
    }
    Vehicle.prototype.describe = function () {
        return "vehicle with " + this.wheels + " wheels";
    };
    Vehicle.count = function () {
        return "counted by " + this.name;
    };
    Vehicle.registry = "vehicle registry";
    return Vehicle;
}());

var Car = (function (_super) {
    __extends(Car, _super);
    function Car(doors) {
        var _this = _super.call(this, 4) || this;
        _this.doors = doors;
        return _this;
    }
    Car.prototype.describe = function () {
        return _super.prototype.describe.call(this) + " and " + this.doors + " doors";
    };
    return Car;
}(Vehicle));

function derive(parent) {
    return (function (_super) {
        __extends(Derived, _super);
        function Derived(extra) {
            var _this = (_super !== null && _super.apply(this, arguments)) || this;
            _this.extra = extra;
            return _this;
        }
        return Derived;
    }(parent));
}

function describe(vehicle) {
  return vehicle.describe();
}

function wheelsOf(vehicle) {
  return vehicle.wheels;
}

var length = 0;
for (var i = 0; i < 2000; i++) length += describe(new Car(i % 4)).length + wheelsOf(new Car(2));
console.log("2000 honest cars", length);

var car = new Car(2);
attempt("a car", function () { return car; });
attempt("describe()", function () { return describe(car); });
attempt("instanceof both", function () { return [car instanceof Car, car instanceof Vehicle]; });
attempt("constructor", function () { return car.constructor === Car; });
attempt("constructor is an own and enumerable member of the prototype", function () { return Object.getOwnPropertyDescriptor(Car.prototype, "constructor").enumerable; });
attempt("for-in over a car", function () { var names = []; for (var name in car) names.push(name); return names; });
attempt("statics are inherited", function () { return [Car.count(), Car.registry, Object.hasOwn(Car, "registry"), Object.getPrototypeOf(Car) === Vehicle]; });

var parents = [
  ["Vehicle", Vehicle],
  ["Car", Car],
  ["null", null],
  ["a class", class Modern { constructor(value) { this.modern = value; } describe() { return "modern " + this.modern; } }],
  ["a parent that returns a literal", function (value) { return { wheels: "from the literal", describe: function () { return "literal " + value; } }; }],
  ["a parent that returns a number", function (value) { this.wheels = value; return 5; }],
  ["Array", Array],
  ["Error", Error],
  ["Object", Object],
  ["a bound Vehicle", Vehicle.bind(null)],
  ["a proxy around Vehicle", new Proxy(Vehicle, {})],
  ["an arrow function", function () { return () => {}; }()],
  ["undefined", undefined],
  ["a number", 5],
  ["a literal", {}],
];

parents.forEach(function (pair) {
  var label = pair[0];
  var Derived;
  attempt(label + ": derive", function () { Derived = undefined; Derived = derive(pair[1]); return typeof Derived; });
  if (!Derived) return;
  var made;
  attempt(label + ": construct", function () { made = undefined; made = new Derived(3); return made; });
  attempt(label + ": instanceof Derived", function () { return made instanceof Derived; });
  attempt(label + ": wheels", function () { return wheelsOf(made); });
  attempt(label + ": describe()", function () { return describe(made); });
  attempt(label + ": isArray, length", function () { return [Array.isArray(made), made.length]; });
  attempt(label + ": parent of the constructor is the parent", function () { return Object.getPrototypeOf(Derived) === pair[1]; });
  attempt("honest again", function () { return describe(new Car(1)); });
});
