function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += +list[i];
  return total;
}

function sumWithoutConversion(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumOfInt32(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (total + (list[i] | 0)) | 0;
  return total;
}

function sumWithACachedLength(list) {
  let total = 0;
  for (let i = 0, n = list.length; i < n; i++) total += +list[i];
  return total;
}

function sumWithForOf(list) {
  let total = 0;
  for (const value of list) total += +value;
  return total;
}

function sumWithForEach(list) {
  let total = 0;
  list.forEach(value => {
    total += +value;
  });
  return total;
}

const uses = [sum, sumWithoutConversion, sumOfInt32, sumWithACachedLength, sumWithForOf, sumWithForEach];
const changes = {
  "stores a text further on": list => {
    list[3] = "100";
  },
  "stores a fraction further on": list => {
    list[3] = 0.5;
  },
  "stores undefined further on": list => {
    list[3] = undefined;
  },
  "deletes an element further on": list => {
    delete list[3];
  },
  "shortens the array": list => {
    list.length = 2;
  },
  "empties the array": list => {
    list.length = 0;
  },
  "pushes an element": list => {
    if (list.length < 8) list.push(1000);
  },
  "pushes a text": list => {
    if (list.length < 8) list.push("1000");
  },
  "stores far past the end": list => {
    list[12] = 1;
  },
  "stores a bigint further on": list => {
    list[3] = 5n;
  },
  "defines a getter further on": list => {
    Object.defineProperty(list, 3, { get: () => 7, configurable: true });
  },
  "changes the prototype and deletes": list => {
    Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { 3: 70 }));
    delete list[3];
  },
  "reverses the array": list => {
    list.reverse();
  },
  "freezes the array": list => {
    Object.freeze(list);
  },
};

for (let i = 0; i < 2000; i++) for (const use of uses) use([i, 1, 2, 3, 4]);
for (const use of uses) {
  for (const name of Object.keys(changes)) {
    attempt(use.name + " while an element " + name, () => {
      let done = false;
      const list = [1, 2, 3, 4, 5];
      list[1] = {
        valueOf() {
          if (!done) {
            done = true;
            changes[name](list);
          }
          return 2;
        },
      };
      return use(list);
    });
  }
  attempt(use.name + " of integers afterwards", () => use([1, 2, 3, 4, 5]));
}
