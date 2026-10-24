function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function product(list) {
  let total = 1;
  for (let i = 0; i < list.length; i++) total *= list[i];
  return total;
}

function bits(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total |= list[i];
  return total;
}

function sumOf(list) {
  let total = 0;
  for (const value of list) total += +value;
  return total;
}

function doubled(list) {
  return list.map(value => value * 2);
}

function largest(list) {
  let best = -Infinity;
  for (let i = 0; i < list.length; i++) if (list[i] > best) best = +list[i];
  return best;
}

function joined(list) {
  return list.join("+");
}

function text(list) {
  let result = "";
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

const uses = { sum, product, bits, sumOf, doubled, largest, joined, text };

const changes = {
  "shrinks the array": list => { list.length = 2; },
  "empties the array": list => { list.length = 0; },
  "pushes": list => { if (list.length < 12) list.push(1); },
  "stores a double ahead": list => { list[3] = 0.5; },
  "stores a string ahead": list => { list[3] = "4"; },
  "deletes ahead": list => { delete list[3]; },
  "replaces itself": list => { list[1] = 2; },
  "shifts": list => { list.shift(); },
  "freezes": list => { Object.freeze(list); },
  "makes it sparse": list => { list[30000] = 1; list.length = 6; },
  "changes the prototype": list => { Object.setPrototypeOf(list, { __proto__: Array.prototype, 3: 1000 }); delete list[3]; },
};

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([1, 2, 3, 4, 5, 6]);

for (const name in changes) {
  for (const use in uses) {
    const list = [1, 2, 3, 4, 5, 6];
    let calls = 0;
    list[1] = {
      valueOf() {
        calls++;
        changes[name](list);
        return 2;
      },
      toString() {
        calls++;
        changes[name](list);
        return "2";
      },
    };
    attempt(use + ", the second element " + name, () => uses[use](list));
    console.log("  calls: " + calls + ", left: " + describe(Array.prototype.map.call(list, value => (typeof value === "object" ? "the object" : value))));
  }
}
