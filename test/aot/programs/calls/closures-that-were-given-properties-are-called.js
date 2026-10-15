function row(label, f) {
  let said;
  try {
    said = f();
  } catch (e) {
    said = "threw " + e.name;
  }
  console.log(label + ": " + String(said));
}
const makers = {
  plain(k) {
    const made = function (n) {
      return k + n;
    };
    made.label = "made " + k;
    return made;
  },
  sometimes(k, alter) {
    const made = function (n) {
      return k * n;
    };
    if (alter) made.altered = true;
    return made;
  },
  later(k) {
    return function (n) {
      return k - n;
    };
  },
  asynchronous(k) {
    const made = async function (n) {
      return k + n;
    };
    made.label = "async";
    return made;
  },
  generating(k) {
    const made = function* (n) {
      yield k + n;
    };
    made.label = "generator";
    return made;
  },
  arrow(k) {
    const made = n => k + n;
    made.label = "arrow";
    return made;
  },
  usesItsProperties(k) {
    const made = function (n) {
      made.calls++;
      return k + n + made.calls;
    };
    made.calls = 0;
    return made;
  },
};
function sum(f, n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += f(i);
  return total;
}

const plain = makers.plain(1);
row("given a property where it is made", () => {
  let total = 0;
  for (let i = 0; i < 4; i++) total += plain(i);
  return total + " " + plain.label;
});

const altered = makers.sometimes(2, true);
const asMade = makers.sometimes(3, false);
row("one closure altered, another of the same function not", () => {
  let total = 0;
  for (let i = 0; i < 4; i++) total += altered(i) + asMade(i);
  return total + " " + altered.altered + " " + asMade.altered;
});

const later = makers.later(10);
function callsLater() {
  let total = 0;
  for (let i = 0; i < 4; i++) total += later(i);
  return total;
}
row("before it is given a property", callsLater);
later.added = 1;
row("afterwards", callsLater);
delete later.added;
row("the property deleted again", callsLater);
Object.defineProperty(later, "name", { value: "renamed" });
Object.defineProperty(later, "length", { value: 7 });
row("name and length redefined", () => callsLater() + " " + later.name + " " + later.length);
Object.setPrototypeOf(later, null);
row("without a prototype", callsLater);
Object.freeze(later);
row("frozen", callsLater);

const asynchronous = makers.asynchronous(1);
row("an async function", () => {
  let said = "";
  for (let i = 0; i < 2; i++) said += typeof asynchronous(i).then;
  return said + " " + asynchronous.label;
});

const generating = makers.generating(1);
row("a generator function", () => {
  let total = 0;
  for (let i = 0; i < 3; i++) total += generating(i).next().value;
  return total + " " + generating.label;
});

const arrow = makers.arrow(5);
row("an arrow", () => {
  let total = 0;
  for (let i = 0; i < 3; i++) total += arrow(i);
  return total + " " + arrow.label;
});

const counting = makers.usesItsProperties(1);
row("it reads and writes its own properties", () => {
  let total = 0;
  for (let i = 0; i < 3; i++) total += counting(i);
  return total + " " + counting.calls;
});

row("handed on as a value", () => sum(plain, 4) + " " + sum(altered, 4) + " " + sum(later, 4) + " " + sum(arrow, 3));

let replaced = makers.plain(100);
function callsReplaced() {
  let total = 0;
  for (let i = 0; i < 3; i++) total += replaced(i);
  return total;
}
row("before another takes its place", callsReplaced);
replaced = Object.assign(n => n * 1000, { label: "made 100" });
row("another function with the same property", callsReplaced);
replaced = { label: "made 100" };
row("an object with the same property", callsReplaced);
replaced = makers.plain(100).bind(null);
row("the function bound", callsReplaced);
replaced = new Proxy(makers.plain(100), {});
row("a proxy of it", callsReplaced);
