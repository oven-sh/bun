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

async function sum(list, pause) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    await pause(i);
    total += list[i];
  }
  return total;
}

async function sumWithACachedLength(list, pause) {
  let total = 0;
  for (let i = 0, length = list.length; i < length; i++) {
    total += list[i];
    await pause(i);
  }
  return total;
}

async function walk(list, pause) {
  const seen = [];
  let turn = 0;
  for (const value of list) {
    await pause(turn++);
    seen.push(value);
    if (seen.length === 9) break;
  }
  return seen;
}

async function readAwaitRead(list, pause) {
  const before = [list.length, list[3]];
  await pause(1);
  return [before, list.length, list[3], 3 in list];
}

async function pushAwaitPush(list, pause) {
  const first = list.push("a");
  await pause(1);
  return [first, list.push("b"), list.length];
}

async function storeAfterAwait(list, pause) {
  list[0] = "before";
  list[3] = await pause(1);
  return list.length;
}

async function storeOfAnAwaitedValue(list, pause) {
  for (let i = 0; i < list.length && i < 8; i++) list[i] = (await pause(i), i * 10);
  return list.length;
}

async function walkAsynchronously(list, pause) {
  const seen = [];
  let turn = 0;
  for await (const value of list) {
    await pause(turn++);
    seen.push(value);
    if (seen.length === 9) break;
  }
  return seen;
}

const uses = { sum, sumWithACachedLength, walk, readAwaitRead, pushAwaitPush, storeAfterAwait, storeOfAnAwaitedValue, walkAsynchronously };

const otherPrototype = {
  __proto__: Array.prototype,
  3: "inherited",
  push() {
    return "the other prototype's push";
  },
};

const changes = {
  "nothing": list => {},
  "stores a double ahead": list => { list[3] = 0.5; },
  "stores a string ahead": list => { list[3] = "s"; },
  "shrinks the length": list => { list.length = 2; },
  "empties it": list => { list.length = 0; },
  "pushes a hundred": list => { for (let i = 0; i < 100; i++) list.push(1); },
  "shifts": list => { list.shift(); },
  "deletes ahead": list => { delete list[3]; },
  "freezes": list => { Object.freeze(list); },
  "defines a getter ahead": list => { Object.defineProperty(list, 3, { get: () => 1000, configurable: true, enumerable: true }); },
  "makes it sparse": list => { list[50000] = 1; list.length = 7; },
  "changes the prototype and deletes ahead": list => { Object.setPrototypeOf(list, otherPrototype); delete list[3]; },
  "removes the prototype": list => { Object.setPrototypeOf(list, null); },
  "adds its own push": list => { list.push = () => "its own push"; },
};

for (const use in uses) for (let i = 0; i < 200; i++) await uses[use]([1, 2, 3, 4, 5, 6], async () => "waited");

for (const use in uses) {
  for (const change in changes) {
    const list = [1, 2, 3, 4, 5, 6];
    let answer;
    try {
      answer = describe(await uses[use](list, async turn => {
        await null;
        if (turn === 1) changes[change](list);
        return "waited";
      }));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(use + ", " + change + ": " + answer + " and left " + describe(list));
  }
}
