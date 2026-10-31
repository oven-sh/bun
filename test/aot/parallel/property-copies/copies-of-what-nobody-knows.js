// Literals and targets of Object.assign that take, beside objects the build can list, objects that it cannot: what is read, listed, deleted and redefined afterwards.
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "function" ? "function" : JSON.stringify(value)));
const parse = text => JSON.parse(text);
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      return String(key) + "=" + ("value" in d ? JSON.stringify(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
    })
    .join(",");

const defaults = { host: "localhost", port: 80, secure: false, depth: 1 };

function spreadUnder(text) {
  const merged = { ...defaults, ...parse(text) };
  return merged;
}
function assignUnder(text) {
  return Object.assign({}, defaults, parse(text));
}
function assignOver(text) {
  return Object.assign({}, parse(text), defaults);
}
function spreadOver(text) {
  return { ...parse(text), ...defaults };
}
function membersInFront(text) {
  return { host: "h", port: 1, ...parse(text) };
}
function membersBehind(text) {
  return { ...parse(text), host: "h", port: 1 };
}
function accessorInFront(text) {
  return {
    get host() {
      return "from the getter";
    },
    set host(value) {
      lines.push("the setter ran with " + value);
    },
    port: 1,
    ...parse(text),
  };
}
function methodInFront(text) {
  return {
    host() {
      return "from the method";
    },
    ...parse(text),
  };
}

const texts = [
  "{}",
  '{"port":8080}',
  '{"port":"eighty","host":7}',
  '{"extra":1,"host":null}',
  '{"depth":1.5,"secure":"yes","more":{"a":1}}',
  '{"__proto__":{"inherited":1,"host":"from above"}}',
  '{"0":"zero","1":"one","port":2}',
  '{"depth":4,"secure":true,"port":3,"host":"other order"}',
  "null",
  '"text"',
  "[1,2]",
  "5",
];
for (const make of [spreadUnder, assignUnder, assignOver, spreadOver, membersInFront, membersBehind, accessorInFront, methodInFront]) {
  for (const text of texts) {
    const made = make(text);
    show(make.name + " " + text, made);
    lines.push("  " + describe(made));
    lines.push("  " + [typeof made.host === "function" ? made.host() : made.host, made.port, made.secure, made.depth, made.extra, made.inherited, made[0]].map(String).join("|"));
    lines.push("  " + (Object.getPrototypeOf(made) === Object.prototype) + " " + ("host" in made) + " " + Object.hasOwn(made, "host") + " " + Object.keys(made).length);
    let listed = "";
    for (const key in made) listed += key + ";";
    lines.push("  " + listed);
    made.port = "stored";
    delete made.host;
    lines.push("  " + describe(made) + " " + String(made.host));
    made.host = "again";
    lines.push("  " + Object.keys(made).join());
    lines.push("  " + JSON.stringify({ ...made }) + JSON.stringify(Object.assign({}, made)));
  }
}

// A source with getters that run code, one of which throws.
let reads = 0;
const counting = {
  get port() {
    reads++;
    return reads;
  },
  get host() {
    reads += 10;
    return "h" + reads;
  },
};
const any = [counting, parse('{"port":5}')];
for (let i = 0; i < 4; i++) {
  const made = { ...defaults, ...any[i & 1] };
  show("getters " + i, made);
  const assigned = Object.assign({}, defaults, any[i & 1]);
  show("getters assigned " + i, assigned);
}
const throwing = {
  a: 1,
  get port() {
    throw new Error("no port");
  },
};
try {
  show("never", { ...defaults, ...[throwing][0] });
} catch (error) {
  show("thrown", error.message);
}

// A setter and a read-only name above the target.
const above = {
  set depth(value) {
    lines.push("the setter above ran with " + value);
  },
  get depth() {
    return "from above";
  },
};
Object.defineProperty(above, "secure", { value: "read-only above", writable: false });
function assignBelow(text) {
  return Object.assign({ __proto__: above }, defaults, parse(text));
}
function spreadBelow(text) {
  return { __proto__: above, ...defaults, ...parse(text) };
}
function assignBelowStrict(text) {
  "use strict";
  try {
    return Object.assign({ __proto__: above }, defaults, parse(text));
  } catch (error) {
    return { thrown: error.constructor.name };
  }
}
for (const make of [assignBelow, spreadBelow, assignBelowStrict]) {
  for (const text of ["{}", '{"port":1}', '{"depth":9,"secure":1}']) {
    let made;
    try {
      made = make(text);
    } catch (error) {
      made = { thrown: error.constructor.name };
    }
    show(make.name + " " + text, made);
    lines.push("  " + describe(made) + " " + String(made.depth) + " " + String(made.secure) + " " + Object.hasOwn(made, "depth"));
  }
}
// The first source changes what stands above the target, so the second meets a setter.
function assignBehindNewPrototype(first) {
  return Object.assign({}, first, defaults);
}
const changesPrototype = parse("{}");
Object.defineProperty(changesPrototype, "__proto__", { value: above, enumerable: true });
for (const first of [changesPrototype, parse('{"x":1}')]) {
  let made;
  try {
    made = assignBehindNewPrototype(first);
  } catch (error) {
    made = { thrown: error.constructor.name };
  }
  lines.push(describe(made) + " " + String(made.depth) + " " + (Object.getPrototypeOf(made) === above));
}
function assignInFrontOfNewPrototype(last) {
  return Object.assign({}, defaults, last);
}
for (const last of [changesPrototype, parse('{"x":1}')]) {
  const made = assignInFrontOfNewPrototype(last);
  lines.push(describe(made) + " " + String(made.depth) + " " + String(made.secure) + " " + (Object.getPrototypeOf(made) === above));
}

// Symbols and names that are not enumerable.
const symbol = Symbol("s");
const withSymbol = parse("{}");
withSymbol[symbol] = 1;
Object.defineProperty(withSymbol, "hidden", { value: 2, enumerable: false });
Object.defineProperty(withSymbol, "port", { value: 3, enumerable: false });
const fromSymbol = { ...defaults, ...withSymbol };
lines.push(describe(fromSymbol));
const frozen = Object.freeze({ ...defaults, ...parse('{"port":9}') });
try {
  "use strict";
  frozen.port = 1;
} catch {}
lines.push(describe(frozen));
const proxied = new Proxy(parse('{"port":6,"z":1}'), {
  ownKeys(target) {
    lines.push("ownKeys");
    return Reflect.ownKeys(target).reverse();
  },
  get(target, key) {
    lines.push("get " + String(key));
    return target[key];
  },
});
lines.push(describe({ ...defaults, ...proxied }));
lines.push(describe(Object.assign({}, defaults, proxied)));

// In a loop that gets hot.
let sum = 0;
const given = [parse('{"port":8080,"depth":3}'), parse('{"secure":true}'), parse("{}"), parse('{"port":"p"}'), parse('{"host":5,"x":1}')];
for (let i = 0; i < 20000; i++) {
  const a = { ...defaults, ...given[i % 5] };
  const b = Object.assign({}, defaults, given[(i + 1) % 5]);
  sum = (sum + String(a.port).length + String(b.port).length + String(a.host).length + (b.secure ? 1 : 0) + a.depth + Object.keys(b).length) | 0;
}
lines.push(String(sum));
console.log(lines.join("\n"));
