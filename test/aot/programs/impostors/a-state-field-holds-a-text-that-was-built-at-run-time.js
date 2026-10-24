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

function make(text) {
  return (0, eval)("(" + text + ")");
}

class Connection {
  constructor() {
    this.state = "idle";
    this.log = [];
  }

  open() {
    if (this.state === "idle") this.state = "opening";
    else this.log.push("open refused in " + String(this.state));
    return this;
  }

  ready() {
    if (this.state === "opening") this.state = "open";
    else this.log.push("ready refused in " + String(this.state));
    return this;
  }

  close() {
    switch (this.state) {
      case "open":
      case "opening":
        this.state = "closed";
        break;
      case "idle":
        this.log.push("never opened");
        break;
      default:
        this.log.push("close refused in " + String(this.state));
    }
    return this;
  }

  get isOpen() {
    return this.state === "open";
  }

  describe() {
    return [typeof this.state, String(this.state), this.isOpen, this.log.join("; ")];
  }
}

const LABELS = { idle: "Idle", opening: "Opening", open: "Open", closed: "Closed" };

function labelOf(connection) {
  return LABELS[connection.state];
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const connection = new Connection().open().ready();
  if (connection.isOpen) total++;
  total += labelOf(connection.close()).length;
}
console.log("2000 honest rounds", total);

const states = [
  "'idle'",
  "'id' + 'le'",
  "'xidle'.slice(1)",
  "'idle\\u4e16'.slice(0, 4)",
  "'IDLE'.toLowerCase()",
  "JSON.parse('\"idle\"')",
  "['i', 'd', 'l', 'e'].join('')",
  "String.fromCharCode(105, 100, 108, 101)",
  "new String('idle')",
  "['idle']",
  "{ toString() { return 'idle'; } }",
  "'unknown'",
  "''",
  "'Idle'",
  "'idle '",
  "0",
  "null",
  "undefined",
  "Symbol('idle')",
  "'open'",
  "'op' + 'en'",
  "new String('open')",
  "'constructor'",
  "'__proto__'",
];

for (const text of states) {
  attempt("stored by name: " + text, () => {
    const connection = new Connection();
    connection.state = make(text);
    const label = labelOf(connection);
    return [typeof label === "string" ? label : typeof label, connection.isOpen, connection.open().ready().close().describe()];
  });
  attempt("stored by a computed name: " + text, () => {
    const connection = new Connection();
    connection[make("'sta' + 'te'")] = make(text);
    return connection.open().ready().describe();
  });
}

attempt("stored by Object.assign", () => Object.assign(new Connection(), { state: "op" + make("'ening'") }).ready().describe());
attempt("stored by Reflect.set", () => {
  const connection = new Connection();
  Reflect.set(connection, "state", new String("opening"));
  return connection.ready().describe();
});
attempt("stored by defineProperty as a getter", () => {
  const answers = ["idle", "opening", "open", "open", "open", "open"];
  let reads = 0;
  const connection = Object.defineProperty(new Connection(), "state", { get: () => answers[reads++], set() {} });
  return [connection.open().ready().isOpen, reads];
});
attempt("copied by spread", () => Connection.prototype.describe.call({ ...new Connection().open(), isOpen: "own" }));
attempt("made from JSON", () => Object.setPrototypeOf(JSON.parse('{ "state": "opening", "log": [] }'), Connection.prototype).ready().describe());
attempt("deleted", () => {
  const connection = new Connection();
  delete connection.state;
  return connection.open().close().describe();
});
attempt("a subclass with other states", () => {
  class Odd extends Connection {
    constructor() {
      super();
      this.state = 7;
    }
  }
  return new Odd().open().close().describe();
});
attempt("honest again", () => new Connection().open().ready().describe());
