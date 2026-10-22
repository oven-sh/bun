const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function note(text, value) {
  log.push(text);
  return value;
}

class Config {
  constructor() {
    this.host = "honest host";
    this.port = 80;
    this.paths = { home: "/", about: "/about" };
    this.debug = undefined;
  }
}

function logging(target) {
  return new Proxy(target, {
    get(inner, key, receiver) {
      log.push("get " + String(key));
      const value = Reflect.get(inner, key, receiver);
      return typeof value === "object" && value !== null ? logging(value) : value;
    },
    has(inner, key) {
      log.push("has " + String(key));
      return Reflect.has(inner, key);
    },
    ownKeys(inner) {
      log.push("ownKeys");
      return Reflect.ownKeys(inner);
    },
    getOwnPropertyDescriptor(inner, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
  });
}

const patterns = [
  ["names out of order", config => { const { port, host } = config; return [port, host]; }],
  ["one name twice", config => { const { host: first, host: second } = config; return [first, second]; }],
  ["defaults that log", config => { const { host = note("default host", "h"), debug = note("default debug", "d"), missing = note("default missing", "m") } = config; return [host, debug, missing]; }],
  ["a default that uses an earlier name", config => { const { port, url = host(port) } = config; function host(value) { return "made from " + value; } return url; }],
  ["computed keys that log", config => { const { [note("key host", "host")]: first, [note("key port", "port")]: second } = config; return [first, second]; }],
  ["nested", config => { const { paths: { home, about }, host } = config; return [home, about, host]; }],
  ["nested with a default for the whole", config => { const { extras: { color } = note("default extras", { color: "none" }) } = config; return color; }],
  ["rest after two names", config => { const { host, port, ...others } = config; return Object.keys(others); }],
  ["rest after a computed key", config => { const { [note("key", "paths")]: paths, ...others } = config; return Object.keys(others); }],
  ["an empty pattern", config => { const {} = config; return "nothing read"; }],
  ["parameters", config => (function ({ host, port = note("default port", 1) }, { debug } = note("default second", {})) { return [host, port, debug]; })(config)],
  ["targets that log", config => { const target = {}; ({ host: note("target object", target).first, port: target[note("target key", "second")] } = config); return target; }],
  ["a target that is a setter", config => { const target = { set host(value) { log.push("set host " + value); } }; ({ host: target.host, port: target.port } = config); return Object.keys(target); }],
  ["a for-of head", config => { const seen = []; for (const { host, port } of [config, config]) seen.push(host, port); return seen; }],
  ["a catch clause", config => { try { throw config; } catch ({ host, port }) { return [host, port]; } }],
  ["an array pattern inside", config => { const { host: [first, second] } = config; return [first, second]; }],
  ["the value of the assignment", config => { let host; return (({ host } = config)) === config; }],
];

const subjects = [
  ["honest", () => new Config()],
  ["a logging proxy around an honest one", () => logging(new Config())],
  ["getters that log", () => ({ get port() { return note("get port", 8080); }, get host() { return note("get host", "getter host"); }, get paths() { return note("get paths", { get about() { return note("get about", "a"); }, get home() { return note("get home", "h"); } }); }, get debug() { return note("get debug", null); } })],
  ["a getter that throws at port", () => ({ get host() { return note("get host", "getter host"); }, get port() { log.push("get port"); throw new RangeError("no port"); }, paths: {} })],
  ["an honest one whose host became a getter that deletes port", () => Object.defineProperty(new Config(), "host", { get() { log.push("get host"); delete this.port; return "deleter"; }, enumerable: true })],
  ["a string", () => "text"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
];

for (let i = 0; i < 2000; i++) for (const [, take] of patterns) take(new Config());
log.length = 0;

for (const [subject, make] of subjects) {
  for (const [label, take] of patterns) {
    let line = subject + " | " + label + " -> ";
    try {
      line += show(take(make()));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    console.log(line + " | log " + log.splice(0).join(", "));
  }
}
