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

const counts = [
  ["3", () => 3],
  ["'2'", () => '2'],
  ["''", () => ''],
  ["' 2 '", () => ' 2 '],
  ["'0x2'", () => '0x2'],
  ["'abc'", () => 'abc'],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["false", () => false],
  ["NaN", () => NaN],
  ["-0", () => -0],
  ["0.5", () => 0.5],
  ["2.9", () => 2.9],
  ["-1", () => -1],
  ["-1.5", () => -1.5],
  ["-Infinity", () => -Infinity],
  ["2n", () => 2n],
  ["[]", () => []],
  ["[2]", () => [2]],
  ["[1, 2]", () => [1, 2]],
  ["({})", () => ({})],
  ["Object.create(null)", () => Object.create(null)],
  ["new Number(2)", () => new Number(2)],
  ["new String('2')", () => new String('2')],
  ["Symbol('s')", () => Symbol('s')],
  ["({ valueOf() { log.push('valueOf'); return 2; }, toString() { log.push('toString'); return '1'; } })", () => ({ valueOf() { log.push('valueOf'); return 2; }, toString() { log.push('toString'); return '1'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '1'; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '1'; } })],
  ["({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })", () => ({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })],
  ["({ valueOf() { log.push('valueOf'); return 2n; } })", () => ({ valueOf() { log.push('valueOf'); return 2n; } })],
  ["({ valueOf() { log.push('valueOf'); return '2'; } })", () => ({ valueOf() { log.push('valueOf'); return '2'; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })],
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

function called(value) {
  return Array(value);
}

function constructed(value) {
  return new Array(value);
}

function fromALength(value) {
  return Array.from({ length: value });
}

function lengthAssigned(value) {
  const list = [1, 2, 3, 4];
  list.length = value;
  return list;
}

function typed(value) {
  return Array.from(new Uint8Array(value));
}

runTable([called, constructed, fromALength, lengthAssigned, typed], counts);
attempt("Array(4294967295).length", () => called(4294967295).length);
attempt("Array(4294967296)", () => called(4294967296));
attempt("Array(2147483648).length", () => constructed(2147483648).length);
attempt("length = 4294967295", () => lengthAssigned(4294967295).length);
attempt("length = 4294967296", () => lengthAssigned(4294967296));
attempt("length = Infinity", () => lengthAssigned(Infinity));
