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

const impostors = [
  ["7", () => 7],
  ["'3'", () => '3'],
  ["''", () => ''],
  ["' 12 '", () => ' 12 '],
  ["'0x10'", () => '0x10'],
  ["'abc'", () => 'abc'],
  ["'1e3'", () => '1e3'],
  ["'-0'", () => '-0'],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["false", () => false],
  ["NaN", () => NaN],
  ["Infinity", () => Infinity],
  ["-Infinity", () => -Infinity],
  ["-0", () => -0],
  ["0.5", () => 0.5],
  ["-1.5", () => -1.5],
  ["2147483647", () => 2147483647],
  ["2147483648", () => 2147483648],
  ["-2147483648", () => -2147483648],
  ["-2147483649", () => -2147483649],
  ["4294967295", () => 4294967295],
  ["4294967297", () => 4294967297],
  ["9007199254740993", () => 9007199254740993],
  ["1e21", () => 1e21],
  ["10n", () => 10n],
  ["-1n", () => -1n],
  ["2n ** 64n", () => 2n ** 64n],
  ["[]", () => []],
  ["[5]", () => [5]],
  ["[1, 2]", () => [1, 2]],
  ["['0x10']", () => ['0x10']],
  ["[[7]]", () => [[7]]],
  ["[null]", () => [null]],
  ["({})", () => ({})],
  ["Object.create(null)", () => Object.create(null)],
  ["new Date(86400000)", () => new Date(86400000)],
  ["new Date(NaN)", () => new Date(NaN)],
  ["new Number(6)", () => new Number(6)],
  ["new String('8')", () => new String('8')],
  ["new Boolean(true)", () => new Boolean(true)],
  ["Object(4n)", () => Object(4n)],
  ["Symbol('s')", () => Symbol('s')],
  ["Object(Symbol('boxed'))", () => Object(Symbol('boxed'))],
  ["Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })", () => Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })],
  ["({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })", () => ({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })],
  ["({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })", () => ({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })],
  ["({ valueOf() { log.push('valueOf'); return 5n; } })", () => ({ valueOf() { log.push('valueOf'); return 5n; } })],
  ["({ valueOf() { log.push('valueOf'); return '21'; } })", () => ({ valueOf() { log.push('valueOf'); return '21'; } })],
  ["({ valueOf() { log.push('valueOf'); return -0; } })", () => ({ valueOf() { log.push('valueOf'); return -0; } })],
  ["({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })", () => ({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })],
  ["({ valueOf: 5, toString() { log.push('toString'); return '17'; } })", () => ({ valueOf: 5, toString() { log.push('toString'); return '17'; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })],
  ["({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })", () => ({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })],
  ["({ [Symbol.toPrimitive]: 5 })", () => ({ [Symbol.toPrimitive]: 5 })],
  ["new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })", () => new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })],
];

function describe(use, [text, make]) {
  log.length = 0;
  const result = outcome(() => use(make()));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, rows) {
  const first = [];
  for (const use of uses) {
    for (const row of rows) {
      first.push(describe(use, row));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const row of rows) {
      const again = describe(use, row);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", row[0], "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

function remainderAssign(value) {
  value %= 3;
  return value;
}

function powerAssign(value) {
  value **= 2;
  return value;
}

function plusAssignAFraction(value) {
  value += 0.5;
  return value;
}

runTable([remainderAssign, powerAssign, plusAssignAFraction], impostors);
