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

var extendsOfTypeScript1 = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};

var extendsOfTypeScript2 = (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();

function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
function _inheritsLoose(t, o) { t.prototype = Object.create(o.prototype), t.prototype.constructor = t, _setPrototypeOf(t, o); }

function extendsOfCoffeeScript(child, parent) {
  for (var key in parent) { if ({}.hasOwnProperty.call(parent, key)) child[key] = parent[key]; }
  function ctor() { this.constructor = child; }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
  child.__super__ = parent.prototype;
  return child;
}

function extendOfBackbone(parent, protoProps, staticProps) {
  var child = function () { return parent.apply(this, arguments); };
  Object.assign(child, parent, staticProps);
  child.prototype = Object.assign(Object.create(parent.prototype), protoProps);
  child.prototype.constructor = child;
  child.__super__ = parent.prototype;
  return child;
}

function soundOf(animal) {
  return animal.sound();
}

function legsOf(animal) {
  return animal.legs;
}

var helpers = [
  ["TypeScript 1", function (Child, Parent) { extendsOfTypeScript1(Child, Parent); return Child; }],
  ["TypeScript 2", function (Child, Parent) { extendsOfTypeScript2(Child, Parent); return Child; }],
  ["Babel loose", function (Child, Parent) { _inheritsLoose(Child, Parent); return Child; }],
  ["CoffeeScript", function (Child, Parent) { return extendsOfCoffeeScript(Child, Parent); }],
  ["Backbone", function (Child, Parent) { return extendOfBackbone(Parent, {}, {}); }],
];

helpers.forEach(function (pair) {
  var label = pair[0];
  function Animal(legs) {
    this.legs = legs;
  }
  Animal.prototype.sound = function () {
    return "a sound from " + this.legs + " legs";
  };
  Animal.kingdom = "animals";
  Animal.create = function (legs) {
    return new this(legs);
  };
  Object.defineProperty(Animal, "secret", { value: "not enumerable" });

  var Bird = pair[1](function Bird(legs) {
    Animal.call(this, legs);
  }, Animal);

  var length = 0;
  for (var i = 0; i < 2000; i++) length += soundOf(new Bird(2)).length + legsOf(new Bird(i % 3));
  console.log(label + ": 2000 honest birds", length);

  attempt(label + ": a bird", function () { return new Bird(2); });
  attempt(label + ": sound()", function () { return soundOf(new Bird(2)); });
  attempt(label + ": instanceof", function () { return [new Bird(2) instanceof Bird, new Bird(2) instanceof Animal]; });
  attempt(label + ": constructor", function () { return new Bird(2).constructor === Bird; });
  attempt(label + ": for-in", function () { var names = []; for (var name in new Bird(2)) names.push(name); return names; });
  attempt(label + ": the static kingdom, own", function () { return [Bird.kingdom, Object.hasOwn(Bird, "kingdom")]; });
  attempt(label + ": the static secret", function () { return Bird.secret; });
  attempt(label + ": create through the child", function () { return Bird.create(2) instanceof Bird; });
  attempt(label + ": the parent of the constructor is Animal", function () { return Object.getPrototypeOf(Bird) === Animal; });

  Animal.kingdom = "changed later";
  Animal.added = "added later";
  attempt(label + ": after the parent's statics changed", function () { return [Bird.kingdom, Bird.added]; });

  Animal.prototype.sound = function () { return "a changed sound"; };
  attempt(label + ": after the parent's method changed", function () { return soundOf(new Bird(2)); });

  Animal.prototype = { sound: function () { return "a sound from a new prototype"; } };
  attempt(label + ": after the parent's prototype was replaced", function () { return [soundOf(new Bird(2)), new Bird(2) instanceof Animal]; });

  Bird.prototype.sound = function () { return "tweet"; };
  attempt(label + ": after the child got its own method", function () { return soundOf(new Bird(2)); });
  attempt(label + ": a literal at the same sites", function () { return [soundOf({ sound: function () { return "a literal"; } }), legsOf({ legs: "many" })]; });
});
