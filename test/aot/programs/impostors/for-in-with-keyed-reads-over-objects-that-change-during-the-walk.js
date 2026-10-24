const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  return String(value);
}

class Row {
  constructor() {
    this.alpha = 1;
    this.beta = 2;
    this.gamma = 3;
    this.delta = 4;
  }
}

function OldRow() {
  this.alpha = 1;
  this.beta = 2;
  this.gamma = 3;
  this.delta = 4;
}
OldRow.prototype.inherited = "from the prototype";

function makeLiteral() {
  return { alpha: 1, beta: 2, gamma: 3, delta: 4 };
}

function walk(row, during) {
  const seen = [];
  for (const name in row) {
    during(row, name);
    seen.push(name + "=" + show(row[name]));
  }
  return seen.join(" ");
}

function walkAndStore(row, during) {
  const seen = [];
  for (const name in row) {
    during(row, name);
    row[name] = name.length;
    seen.push(name);
  }
  return seen.join(" ") + " | " + JSON.stringify(row);
}

function walkOwn(row, during) {
  const seen = [];
  for (const name in row) {
    if (!Object.prototype.hasOwnProperty.call(row, name)) continue;
    during(row, name);
    seen.push(name + "=" + show(row[name]));
  }
  return seen.join(" ");
}

function nothing() {}

const changes = [
  ["nothing", nothing],
  ["deletes the next name", (row, name) => { if (name === "alpha") delete row.beta; }],
  ["deletes the name it is at", (row, name) => { if (name === "beta") delete row.beta; }],
  ["deletes an earlier name", (row, name) => { if (name === "gamma") delete row.alpha; }],
  ["deletes the next name and adds it again", (row, name) => { if (name === "alpha") { delete row.gamma; row.gamma = "again"; } }],
  ["deletes every name", (row, name) => { if (name === "alpha") for (const each of Object.keys(row)) delete row[each]; }],
  ["adds a name", (row, name) => { if (name === "alpha") row.epsilon = 5; }],
  ["stores to a later name", (row, name) => { if (name === "alpha") row.delta = "stored"; }],
  ["turns a later name into a getter", (row, name) => { if (name === "alpha") Object.defineProperty(row, "gamma", { get() { log.push("get gamma"); return "got"; }, enumerable: true, configurable: true }); }],
  ["hides a later name from enumeration", (row, name) => { if (name === "alpha") Object.defineProperty(row, "gamma", { enumerable: false }); }],
  ["removes the prototype", (row, name) => { if (name === "alpha") Object.setPrototypeOf(row, null); }],
  ["moves it under a prototype with more names", (row, name) => { if (name === "alpha") Object.setPrototypeOf(row, { zeta: "inherited zeta", beta: "shadowed" }); }],
  ["deletes a name that the new prototype also has", (row, name) => { if (name === "alpha") { Object.setPrototypeOf(row, { gamma: "inherited gamma" }); delete row.gamma; } }],
  ["adds an index name", (row, name) => { if (name === "alpha") row[0] = "zero"; }],
  ["freezes it", (row, name) => { if (name === "beta") Object.freeze(row); }],
];

const walks = [
  ["row[name]", walk],
  ["row[name] = ..", walkAndStore],
  ["own names only", walkOwn],
];

const kinds = [
  ["class", () => new Row()],
  ["constructor function", () => new OldRow()],
  ["literal", makeLiteral],
];

for (let i = 0; i < 2000; i++) for (const [, make] of kinds) for (const [, each] of walks) each(make(), nothing);

for (const [kind, make] of kinds) {
  for (const [walkLabel, each] of walks) {
    for (const [changeLabel, change] of changes) {
      let line = kind + " | " + walkLabel + " | " + changeLabel + " -> ";
      try {
        line += each(make(), change);
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
    }
  }
}
