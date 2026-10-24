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

function countedUpTo(value) {
  let count = 0;
  for (let i = 0; i < value; i++) {
    count++;
    if (count === 10) break;
  }
  return count;
}

function countedUpToAndIncluding(value) {
  let count = 0;
  for (let i = 0; i <= value; i++) {
    count++;
    if (count === 10) break;
  }
  return count;
}

function countedDownFrom(value) {
  const seen = [];
  for (let i = value; i > 0; i--) {
    seen.push(i);
    if (seen.length === 4) break;
  }
  return seen;
}

function countedDownInPlace(value) {
  const seen = [];
  while (value--) {
    seen.push(value);
    if (seen.length === 4) break;
  }
  return seen;
}

function countedUntilDifferent(value) {
  let count = 0;
  for (let i = 0; i !== value; i++) {
    count++;
    if (count === 10) break;
  }
  return count;
}

runTable([countedUpTo, countedUpToAndIncluding, countedDownFrom, countedDownInPlace, countedUntilDifferent], counts.concat([["Infinity", () => Infinity], ["2147483648", () => 2147483648], ["'10'", () => '10'], ["'9'", () => '9']]));
