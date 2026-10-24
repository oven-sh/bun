function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

const made = {
  "'alpha'": () => ('alpha'),
  "'delta'": () => ('delta'),
  "'eta'": () => ('eta'),
  "'omega'": () => ('omega'),
  "''": () => (''),
  "'al' + 'pha'": () => ('al' + 'pha'),
  "'xdelta'.slice(1)": () => ('xdelta'.slice(1)),
  "'gamma\\u4e16'.slice(0, 5)": () => ('gamma\u4e16'.slice(0, 5)),
  "['be', 'ta'].join('')": () => (['be', 'ta'].join('')),
  "'ALPHA'.toLowerCase()": () => ('ALPHA'.toLowerCase()),
  "new String('alpha')": () => (new String('alpha')),
  "new String('')": () => (new String('')),
  "['alpha']": () => (['alpha']),
  "[['delta']]": () => ([['delta']]),
  "[]": () => ([]),
  "{ toString() { log.push('toString'); return 'delta'; } }": () => ({ toString() { log.push('toString'); return 'delta'; } }),
  "{ valueOf() { log.push('valueOf'); return 'gamma'; } }": () => ({ valueOf() { log.push('valueOf'); return 'gamma'; } }),
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'beta'; } }": () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return 'beta'; } }),
  "{ turn: 0, toString() { log.push('toString'); return ['x', 'x', 'gamma', 'x'][this.turn++]; } }": () => ({ turn: 0, toString() { log.push('toString'); return ['x', 'x', 'gamma', 'x'][this.turn++]; } }),
  "1": () => (1),
  "'1'": () => ('1'),
  "1n": () => (1n),
  "true": () => (true),
  "0": () => (0),
  "null": () => (null),
  "'null'": () => ('null'),
  "undefined": () => (undefined),
  "Symbol('alpha')": () => (Symbol('alpha')),
  "NaN": () => (NaN),
};

function make(text) {
  return made[text]();
}

const log = [];
globalThis.log = log;

function strictChain(word) {
  if (word === "alpha") return 1;
  else if (word === "beta") return 2;
  else if (word === "gamma") return 3;
  else if (word === "delta") return 4;
  else if (word === "epsilon") return 5;
  else if (word === "zeta") return 6;
  else if (word === "eta") return 7;
  else if (word === "") return 8;
  return 0;
}

function looseChain(word) {
  if (word == "alpha") return 1;
  else if (word == "beta") return 2;
  else if (word == "gamma") return 3;
  else if (word == "delta") return 4;
  else if (word == "1") return 5;
  else if (word == "") return 6;
  else if (word == "null") return 7;
  return 0;
}

function orChain(word) {
  return word === "alpha" || word === "beta" || word === "gamma" || word === "delta" || word === "epsilon";
}

function notChain(word) {
  return word !== "alpha" && word !== "beta" && word !== "gamma" && word !== "delta";
}

function conditionalChain(word) {
  return word === "alpha" ? "a" : word === "beta" ? "b" : word === "gamma" ? "g" : word === "delta" ? "d" : "?";
}

function mixedChain(word) {
  if (word === "alpha") return "text alpha";
  if (word === 1) return "number one";
  if (word === "1") return "text one";
  if (word === null) return "null";
  if (word === "null") return "text null";
  if (word === undefined) return "undefined";
  if (word === true) return "true";
  return "none";
}

function chainOnAMember(holder) {
  if (holder.kind === "alpha") return 1;
  if (holder.kind === "beta") return 2;
  if (holder.kind === "gamma") return 3;
  if (holder.kind === "delta") return 4;
  return 0;
}

function chainOnTypeof(value) {
  const kind = typeof value;
  if (kind === "string") return "s" + value.length;
  if (kind === "number") return "n";
  if (kind === "object") return "o";
  if (kind === "undefined") return "u";
  if (kind === "symbol") return "y";
  if (kind === "bigint") return "b";
  if (kind === "boolean") return "t";
  return "f";
}

const uses = [
  ["strict", strictChain],
  ["loose", looseChain],
  ["or", orChain],
  ["not", notChain],
  ["conditional", conditionalChain],
  ["mixed", mixedChain],
  ["member", value => chainOnAMember({ kind: value })],
  ["typeof", chainOnTypeof],
];

const values = [
  "'alpha'",
  "'delta'",
  "'eta'",
  "'omega'",
  "''",
  "'al' + 'pha'",
  "'xdelta'.slice(1)",
  "'gamma\\u4e16'.slice(0, 5)",
  "['be', 'ta'].join('')",
  "'ALPHA'.toLowerCase()",
  "new String('alpha')",
  "new String('')",
  "['alpha']",
  "[['delta']]",
  "[]",
  "{ toString() { log.push('toString'); return 'delta'; } }",
  "{ valueOf() { log.push('valueOf'); return 'gamma'; } }",
  "{ [Symbol.toPrimitive](hint) { log.push(hint); return 'beta'; } }",
  "{ turn: 0, toString() { log.push('toString'); return ['x', 'x', 'gamma', 'x'][this.turn++]; } }",
  "1",
  "'1'",
  "1n",
  "true",
  "0",
  "null",
  "'null'",
  "undefined",
  "Symbol('alpha')",
  "NaN",
];

let total = 0;
const honest = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "", "omega"];
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(honest[i % honest.length])).length;
}
console.log("2000 honest rounds", total);

for (const text of values) {
  console.log(text + " -> " + uses.map(([name, use]) => {
    try {
      return name + " " + show(use(make(text)));
    } catch (error) {
      return name + " threw " + error.constructor.name;
    }
  }).join("; "));
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

attempt("a member that is a getter is read once for each comparison", () => {
  let reads = 0;
  const result = chainOnAMember({ get kind() { reads++; return "delta"; } });
  return [result, reads];
});
attempt("a member that answers differently each time", () => {
  const answers = ["beta", "alpha", "x", "delta"];
  let reads = 0;
  return chainOnAMember({ get kind() { return answers[reads++]; } });
});
