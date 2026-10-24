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

function fixedView() {
  const buffer = new ArrayBuffer(6, { maxByteLength: 12 });
  const list = new Uint8Array(buffer, 0, 6);
  list.set([1, 2, 3, 4, 5, 6]);
  return list;
}

function trackingView() {
  const buffer = new ArrayBuffer(6, { maxByteLength: 12 });
  const list = new Uint8Array(buffer);
  list.set([1, 2, 3, 4, 5, 6]);
  return list;
}

function trackingViewWithAnOffset() {
  const buffer = new ArrayBuffer(8, { maxByteLength: 12 });
  const list = new Uint8Array(buffer, 2);
  list.set([1, 2, 3, 4, 5, 6]);
  return list;
}

function plainView() {
  return new Uint8Array([1, 2, 3, 4, 5, 6]);
}

function doubles() {
  const buffer = new ArrayBuffer(48, { maxByteLength: 96 });
  const list = new Float64Array(buffer);
  list.set([1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
  return list;
}

const makers = { plainView, fixedView, trackingView, trackingViewWithAnOffset, doubles };

const changes = {
  "nothing": list => {},
  "transfers the buffer away": list => { list.buffer.transfer(); },
  "clones the buffer away": list => { structuredClone(list.buffer, { transfer: [list.buffer] }); },
  "shrinks the buffer": list => { list.buffer.resize(list.BYTES_PER_ELEMENT * 3); },
  "shrinks the buffer to nothing": list => { list.buffer.resize(0); },
  "grows the buffer": list => { list.buffer.resize(list.BYTES_PER_ELEMENT * 9); },
  "shrinks and grows the buffer": list => { list.buffer.resize(list.BYTES_PER_ELEMENT * 2); list.buffer.resize(list.BYTES_PER_ELEMENT * 8); },
};

const uses = {
  sum(list, change) {
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      if (i === 1) change();
      total += list[i];
    }
    return total;
  },
  sumWithACachedLength(list, change) {
    let total = 0;
    for (let i = 0, length = list.length; i < length; i++) {
      if (i === 1) change();
      total += list[i];
    }
    return total;
  },
  renumber(list, change) {
    for (let i = 0, length = list.length; i < length; i++) {
      if (i === 1) change();
      list[i] = i * 10;
    }
    return list.length;
  },
  collect(list, change) {
    const seen = [];
    for (const value of list) {
      if (seen.length === 1) change();
      seen.push(value);
    }
    return seen;
  },
  storeOfAnObject(list, change) {
    list[4] = { valueOf() { change(); return 9; } };
    return [list.length, list[4]];
  },
  readsAroundTheChange(list, change) {
    return [list.length, list[4], 4 in list, change(), list.length, list[4], 4 in list, list.byteLength, list.byteOffset];
  },
  spreadAfterwards(list, change) {
    change();
    return [...list];
  },
};

for (const use in uses) for (let i = 0; i < 500; i++) uses[use]([1, 2, 3, 4, 5, 6], () => {});
for (const use in uses) for (let i = 0; i < 500; i++) uses[use](plainView(), () => {});

for (const maker in makers) {
  for (const name in changes) {
    if (maker === "plainView" && name.includes("the buffer") && !name.includes("away")) continue;
    for (const use in uses) {
      const list = makers[maker]();
      attempt(maker + ", " + use + ", " + name, () => uses[use](list, () => changes[name](list)));
    }
  }
}
