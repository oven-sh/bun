// Loops read a method, a value and a getter off objects that Object.setPrototypeOf() has put below another object.
// In the middle of a loop the object above changes, or one of the objects below does, and every turn behind the change sees it.
class Message {
  constructor(count) {
    this.count = count;
  }
}

function makeAbove() {
  const above = Object.create(Message.prototype);
  above.step = function () {
    return this.count + 1;
  };
  above.label = "first";
  return above;
}

function putBelow(above) {
  const messages = [];
  for (let i = 0; i < 8; i++) messages.push(Object.setPrototypeOf(new Message(i), above));
  return messages;
}

function callsAndReads(messages, change) {
  let sum = 0;
  let labels = "";
  for (let i = 0; i < 4000; i++) {
    if (i === 3000) change();
    const message = messages[i & 7];
    const step = message.step;
    sum += typeof step === "function" ? message.step() : -1;
    if ((i & 511) === 0) labels += message.label + ",";
  }
  return sum + " " + labels;
}

function show(name, change) {
  const above = makeAbove();
  const messages = putBelow(above);
  console.log(name, callsAndReads(messages, () => change(above, messages)));
}

show("nothing changes", () => {});
show("the method is replaced", above => {
  above.step = function () {
    return this.count + 100;
  };
});
show("the value is replaced", above => {
  above.label = "second";
});
show("the method is deleted", above => {
  delete above.step;
});
show("the value is deleted", above => {
  delete above.label;
});
show("the method becomes a getter", above => {
  Object.defineProperty(above, "step", {
    get() {
      return () => 1000;
    },
  });
});
show("one object is put below another object", (above, messages) => {
  Object.setPrototypeOf(messages[0], { step: () => 7000, label: "other" });
});
show("one object goes back below its class", (above, messages) => {
  Object.setPrototypeOf(messages[0], Message.prototype);
});
show("one object loses its prototype", (above, messages) => {
  Object.setPrototypeOf(messages[0], null);
});
show("the object above is put below another object and loses the names", above => {
  Object.setPrototypeOf(above, { step: () => 9000, label: "higher" });
  delete above.step;
  delete above.label;
});
show("the object above gets many names and loses them", above => {
  for (let i = 0; i < 200; i++) above["name" + i] = i;
  for (let i = 0; i < 200; i++) delete above["name" + i];
  above.label = "still here";
});
show("the object above is frozen", above => {
  Object.freeze(above);
});
show("the object above is put below a proxy and loses the names", above => {
  Object.setPrototypeOf(above, new Proxy({}, { get: (target, key) => (key === "step" ? () => 11000 : "from the proxy") }));
  delete above.step;
  delete above.label;
});

// Objects of another class, one of which gets the names itself.
class Letter {
  constructor(count) {
    this.count = count;
  }
}
const aboveLetters = Object.create(Letter.prototype);
aboveLetters.step = function () {
  return this.count + 1;
};
aboveLetters.label = "first";
const letters = [];
for (let i = 0; i < 8; i++) letters.push(Object.setPrototypeOf(new Letter(i), aboveLetters));
let sumOfLetters = 0;
let labelsOfLetters = "";
for (let i = 0; i < 4000; i++) {
  if (i === 3000) {
    letters[0].step = () => 5000;
    letters[0].label = "own";
  }
  const letter = letters[i & 7];
  sumOfLetters += letter.step();
  if ((i & 511) === 0) labelsOfLetters += letter.label + ",";
}
console.log("one object gets the names itself", sumOfLetters, labelsOfLetters);

// One getter, which the literal above has from the start.
function makeLiteralAbove() {
  return {
    get twice() {
      return this.x * 2;
    },
  };
}

function readsThroughGetter(below, change) {
  let sum = 0;
  for (let i = 0; i < 4000; i++) {
    if (i === 3000) change();
    const twice = below[i & 3].twice;
    sum += twice === undefined ? -1 : twice;
  }
  return sum;
}

function showGetter(name, change) {
  const above = makeLiteralAbove();
  const below = [];
  for (let i = 0; i < 4; i++) below.push(Object.setPrototypeOf({ x: i }, above));
  console.log(name, readsThroughGetter(below, () => change(above, below)));
}

showGetter("nothing changes", () => {});
showGetter("the getter is deleted", above => {
  delete above.twice;
});
showGetter("the getter becomes a value", above => {
  Object.defineProperty(above, "twice", { value: 300 });
});
showGetter("the getter loses its function", above => {
  Object.defineProperty(above, "twice", { get: undefined });
});
showGetter("one object gets the name itself", (above, below) => {
  Object.defineProperty(below[1], "twice", { value: 500 });
});
showGetter("one object is put below an object without the name", (above, below) => {
  Object.setPrototypeOf(below[1], {});
});
showGetter("one object goes back below Object.prototype", (above, below) => {
  Object.setPrototypeOf(below[1], Object.prototype);
});
showGetter("the field that the getter reads changes", (above, below) => {
  below[2].x = 0.5;
});
