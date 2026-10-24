// Several uses of the key in one for-in body: own and inherited keys, objects that change between the uses, other objects under the same key, getters, proxies, arrays and nested loops.
function copyOwn(from) {
  const to = {};
  for (const key in from) {
    if (Object.hasOwn(from, key)) to[key] = from[key];
  }
  return to;
}

function describe(object) {
  const parts = [];
  for (const key in object) {
    parts.push(key + ":" + (key in object) + ":" + object.hasOwnProperty(key) + ":" + String(object[key]));
  }
  return parts.join(" ");
}

function deleteNextThenRead(object, doomed) {
  const parts = [];
  for (const key in object) {
    const before = object[key];
    delete object[doomed];
    parts.push(key + "=" + before + "/" + object[key] + "/" + (key in object) + "/" + Object.hasOwn(object, key));
  }
  return parts.join(" ");
}

function addThenRead(object) {
  const parts = [];
  let added = 0;
  for (const key in object) {
    const before = Object.hasOwn(object, key);
    object["added" + added++] = key;
    parts.push(key + "=" + before + "/" + object[key] + "/" + Object.hasOwn(object, key));
  }
  return parts.join(" ") + " | " + Object.keys(object).join(",");
}

function redefineThenRead(object, log) {
  const parts = [];
  for (const key in object) {
    const before = object[key];
    Object.defineProperty(object, key, {
      get() {
        log.push("get " + key);
        return "getter of " + key;
      },
      enumerable: true,
      configurable: true,
    });
    parts.push(before + "->" + object[key] + ":" + (key in object));
  }
  return parts.join(" ");
}

function compare(a, b) {
  const parts = [];
  for (const key in a) {
    parts.push(key + ":" + (key in b) + ":" + Object.hasOwn(b, key) + ":" + (a[key] === b[key]) + ":" + b[key]);
  }
  return parts.join(" ");
}

function callBetween(object, action) {
  const parts = [];
  for (const key in object) {
    const before = object[key];
    action(object, key);
    parts.push(key + "=" + before + "/" + object[key] + "/" + Object.hasOwn(object, key));
  }
  return parts.join(" ");
}

function sumInInnerLoop(object, rounds) {
  let sum = 0;
  for (const key in object) {
    for (let i = 0; i < rounds; i++) if (Object.hasOwn(object, key)) sum += object[key];
  }
  return sum;
}

function table(rows) {
  const parts = [];
  for (const row in rows) {
    for (const column in rows[row]) {
      if (Object.hasOwn(rows, row) && Object.hasOwn(rows[row], column)) parts.push(row + "." + column + "=" + rows[row][column]);
    }
  }
  return parts.join(" ");
}

const show = object => JSON.stringify(object);
const point = () => ({ x: 1, y: 2, z: 3 });

let checksum = 0;
for (let i = 0; i < 20000; i++) {
  const copy = copyOwn({ a: i, b: i + 1, c: "text" });
  checksum = (checksum + copy.a + copy.b + copy.c.length + sumInInnerLoop(point(), 3)) | 0;
}
console.log(checksum);

console.log(show(copyOwn(point())), describe(point()));

const base = { inherited: "base", shadowed: "base" };
const derived = Object.create(base);
derived.own = "derived";
derived.shadowed = "derived";
console.log(show(copyOwn(derived)), describe(derived));

console.log(deleteNextThenRead(point(), "y"), "|", deleteNextThenRead(point(), "x"), "|", deleteNextThenRead(point(), "z"));
console.log(addThenRead(point()));
const log = [];
console.log(redefineThenRead(point(), log), log.join(";"));

console.log(compare(point(), point()), "|", compare(point(), { x: 1, z: 4 }), "|", compare(point(), Object.create(point())), "|", compare(point(), [7, 8]));
console.log(callBetween(point(), () => {}), "|", callBetween(point(), (object, key) => delete object[key]), "|", callBetween(point(), (object, key) => (object[key] *= 10)));
console.log(callBetween(point(), object => Object.setPrototypeOf(object, base)), "|", callBetween(point(), object => Object.freeze(object)));

console.log(describe([10, , 30]), "|", describe(new String("ab")), "|", describe(Object.assign([1], { named: 2 })), "|", describe(new Map([[1, 2]])));
console.log(describe(Object.assign(Object.create(null), { bare: 1, hasOwnProperty: () => "mine" })));

const trapped = [];
const proxy = new Proxy(point(), {
  has(target, key) {
    trapped.push("has " + String(key));
    return key in target;
  },
  get(target, key) {
    trapped.push("get " + String(key));
    return target[key];
  },
  getOwnPropertyDescriptor(target, key) {
    trapped.push("describe " + String(key));
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
console.log(show(copyOwn(proxy)), trapped.join(","));

console.log(table({ first: { a: 1, b: 2 }, second: { c: 3 } }), "|", table([{ a: 1 }, [5, 6]]));

const wide = {};
for (let i = 0; i < 200; i++) wide["key" + i] = i;
console.log(sumInInnerLoop(wide, 2), Object.keys(copyOwn(wide)).length);
delete wide.key7;
console.log(sumInInnerLoop(wide, 2), Object.keys(copyOwn(wide)).length);
