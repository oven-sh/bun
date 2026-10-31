// What a function that only hands `this` on constructs gets one key in every way the language has, while elsewhere the program defines that key hidden. Each case has a function and a key of its own.
const lines = [];
function show(label, object, key) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(
    label + ": " + JSON.stringify(Object.getOwnPropertyDescriptor(object, key)) + " | " + Object.keys(object).join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + names.join() +
      " | " + JSON.stringify(object) + " | " + JSON.stringify({ ...object }) + " | " + JSON.stringify(Object.assign({}, object)) + " | " + JSON.stringify(Object.entries(object)) + " | " + (key in object) + " " + Object.hasOwn(object, key),
  );
}
function attempt(label, action) {
  try {
    lines.push(label + ": " + JSON.stringify(action()));
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
}
function read(object, key) {
  let sum = 0;
  for (let turn = 0; turn < 60; turn++) sum += object[key] ?? -1;
  return sum;
}
function cases(name, Made, key, hide) {
  const ways = {
    hidden: hide,
    stored: (made) => { made.first = 0; made[key] = 1; },
    "stored then defined by value alone": (made) => { made[key] = 1; Object.defineProperty(made, key, { value: 6 }); },
    "assigned a literal": (made) => Object.assign(made, { [key]: 2, other: 3 }),
    "assigned parsed text": (made) => Object.assign(made, JSON.parse('{"' + key + '":3}')),
    "Reflect.set": (made) => Reflect.set(made, key, 4),
    "defined plain": (made) => Object.defineProperty(made, key, { value: 5, writable: true, enumerable: true, configurable: true }),
    "defined by a getter": (made) => Object.defineProperty(made, key, { get: () => 7, configurable: true }),
    "defineProperties": (made) => Object.defineProperties(made, { [key]: { value: 8, enumerable: true } }),
    "hidden behind another name": (made) => { made.first = 0; hide(made); made.last = 9; },
    "hidden twice": (made) => { hide(made); attempt(name + " | a second time", () => hide(made) === made); },
    "closed first": (made) => { Object.preventExtensions(made); attempt(name + " | defined on a closed object", () => hide(made) === made); },
    "frozen behind": (made) => { hide(made); Object.freeze(made); },
    "nothing": () => {},
  };
  for (const [way, fill] of Object.entries(ways)) {
    let made;
    try {
      made = new Made(fill);
    } catch (error) {
      lines.push(name + " | " + way + " is not constructed: " + error.constructor.name);
      continue;
    }
    show(name + " | " + way, made, key);
    lines.push(name + " | " + way + " read: " + read(made, key));
    attempt(name + " | " + way + " stored over", () => (made[key] = 11));
    attempt(name + " | " + way + " deleted", () => delete made[key]);
    attempt(name + " | " + way + " defined again", () => Object.defineProperty(made, key, { value: 12, enumerable: true }) === made);
    show(name + " | " + way + " at the end", made, key);
  }
}
function First(fill) { fill(this); }
cases("all false", First, "k1", (made) => Object.defineProperty(made, "k1", { value: 1 }));
function Second(fill) { fill(this); }
cases("not enumerable", Second, "k2", (made) => Object.defineProperty(made, "k2", { value: 1, writable: true, configurable: true }));
function Third(fill) { fill(this); }
cases("read-only", Third, "k3", (made) => Reflect.defineProperty(made, "k3", { value: 1, enumerable: true, configurable: true }) && made);
function Fourth(fill) { fill(this); }
class Below extends Fourth {
  k4 = 20;
}
cases("a class below has a field of the name", Below, "k4", (made) => Object.defineProperty(made, "k4", { value: 1 }));
cases("the function above that class", Fourth, "k4", (made) => Object.defineProperty(made, "k4", { value: 1 }));
function Fifth(fill) { fill(this); }
Fifth.prototype.k5 = 30;
cases("the prototype has the name", Fifth, "k5", (made) => Object.defineProperty(made, "k5", { value: 1 }));
function Sixth(fill) { fill(this); }
Object.defineProperty(Sixth.prototype, "k6", { set(value) { lines.push("setter " + value); }, get() { return 40; }, configurable: true });
cases("the prototype has an accessor", Sixth, "k6", (made) => Object.defineProperty(made, "k6", { value: 1 }));
function Seventh(fill) { fill(this); }
const borrowed = {};
Seventh.call(borrowed, (made) => Object.defineProperty(made, "k7", { value: 1 }));
show("called on a literal", borrowed, "k7");
show("constructed for another function", Reflect.construct(Seventh, [(made) => Object.defineProperty(made, "k7", { value: 1 })], First), "k7");
console.log(lines.join("\n"));
