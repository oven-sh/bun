// An integer variable is incremented after it got a value nobody knows.
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

const log = [];

function make(text) {
  return new Function("log", "return (" + text + ");")(log);
}

const impostors = [
  "7",
  "'3'",
  "''",
  "' 12 '",
  "'0x10'",
  "'abc'",
  "'1e3'",
  "'-0'",
  "null",
  "undefined",
  "true",
  "false",
  "NaN",
  "Infinity",
  "-Infinity",
  "-0",
  "0.5",
  "-1.5",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967297",
  "9007199254740993",
  "1e21",
  "10n",
  "-1n",
  "2n ** 64n",
  "[]",
  "[5]",
  "[1, 2]",
  "['0x10']",
  "[[7]]",
  "[null]",
  "({})",
  "Object.create(null)",
  "new Date(86400000)",
  "new Date(NaN)",
  "new Number(6)",
  "new String('8')",
  "new Boolean(true)",
  "Object(4n)",
  "Symbol('s')",
  "Object(Symbol('boxed'))",
  "Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })",
  "({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })",
  "({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })",
  "({ valueOf() { log.push('valueOf'); return 5n; } })",
  "({ valueOf() { log.push('valueOf'); return '21'; } })",
  "({ valueOf() { log.push('valueOf'); return -0; } })",
  "({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })",
  "({ valueOf: 5, toString() { log.push('toString'); return '17'; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })",
  "({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })",
  "({ [Symbol.toPrimitive]: 5 })",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })",
];

function describe(use, text) {
  log.length = 0;
  const result = outcome(() => use(make(text)));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, texts) {
  const first = [];
  for (const use of uses) {
    for (const text of texts) {
      first.push(describe(use, text));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const text of texts) {
      const again = describe(use, text);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", text, "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];

function incremented(unknown) {
  let index = 0;
  index = unknown;
  index++;
  return [letters[index], index, typeof index];
}

function decremented(unknown) {
  let index = 0;
  index = unknown;
  --index;
  return [letters[index], index, typeof index];
}

function incrementedInALoop(unknown) {
  let index = 0;
  const seen = [];
  for (let round = 0; round < 3; round++) {
    seen.push(letters[index]);
    index++;
    if (round === 0) index = unknown;
  }
  seen.push(index);
  return seen;
}

function shifted(unknown) {
  let bits = 1;
  bits = unknown;
  bits <<= 1;
  return [bits, letters[bits]];
}

runTable([incremented, decremented, incrementedInALoop, shifted], impostors);
