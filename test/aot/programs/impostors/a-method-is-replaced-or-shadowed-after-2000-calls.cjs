const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()) + " | log " + log.splice(0).join(", "));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name + " | log " + log.splice(0).join(", "));
  }
}

function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function () {
  return this.name + " makes a sound";
};

function Dog(name) {
  Animal.call(this, name);
}
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
Dog.prototype.speak = function () {
  return this.name + " barks";
};

class Cat {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return this.name + " meows";
  }
}

function speakOf(animal) {
  return animal.speak();
}

function speakOfEach(animals) {
  const heard = [];
  for (let i = 0; i < animals.length; i++) {
    try {
      heard.push(animals[i].speak());
    } catch (error) {
      heard.push(error.constructor.name);
    }
  }
  return heard.join("; ");
}

for (const [kind, Maker] of [
  ["constructor function", Dog],
  ["class", Cat],
]) {
  const original = Maker.prototype.speak;
  const one = new Maker("one");
  const two = new Maker("two");
  let length = 0;
  for (let i = 0; i < 2000; i++) length += speakOf(i % 2 ? one : two).length;
  console.log(kind, "2000 honest calls", length);

  const both = label => {
    attempt(kind + ", " + label + ", one", () => speakOf(one));
    attempt(kind + ", " + label + ", two", () => speakOf(two));
    attempt(kind + ", " + label + ", a new one and both in a loop", () => speakOfEach([new Maker("new"), one, two]));
  };

  both("untouched");
  Maker.prototype.speak = function () {
    return this.name + " was replaced";
  };
  both("replaced by a store");
  one.speak = function () {
    return this.name + " has its own";
  };
  both("shadowed on one");
  delete one.speak;
  both("the shadow deleted");
  Object.defineProperty(Maker.prototype, "speak", {
    get() {
      log.push("get speak of " + this.name);
      return original;
    },
    configurable: true,
  });
  both("turned into a getter");
  delete Maker.prototype.speak;
  both("deleted from the prototype");
  Maker.prototype[["sp", "eak"].join("")] = function () {
    return this.name + " was replaced under a joined name";
  };
  both("replaced under a joined name");
  Maker.prototype.speak = 5;
  both("replaced by a number");
  Maker.prototype.speak = () => "an arrow function has no this";
  both("replaced by an arrow function");
  Maker.prototype.speak = original.bind({ name: "bound" });
  both("replaced by a bound function");
  Object.defineProperty(two, "speak", { value: original, writable: false });
  both("two gets the original as its own member");
  Maker.prototype.speak = original;
  both("the original is back");
}
