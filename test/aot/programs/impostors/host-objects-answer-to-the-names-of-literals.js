function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function makeAddress(host, port, pathname) {
  return { host, port, pathname, search: "" };
}

function makeUpload(size, type, name) {
  return { size, type, name };
}

function makeAnswer(status, ok, statusText) {
  return { status, ok, statusText };
}

function makeFailure(name, message) {
  return { name, message, code: 0 };
}

const families = [
  {
    label: "address",
    honest: () => makeAddress("example.com:8080", "8080", "/a"),
    names: ["host", "port", "pathname", "search"],
    impostors: [
      ["a URL", () => new URL("http://example.com:8080/a")],
      ["a URL without a port", () => new URL("https://example.com/")],
      ["an object that inherits from a URL", () => Object.create(new URL("http://example.com:8080/a"))],
      ["a copy of a URL by spread", () => ({ ...new URL("http://example.com:8080/a") })],
      ["a URLSearchParams", () => new URLSearchParams("host=x&port=1")],
      ["a string", () => "http://example.com:8080/a"],
    ],
  },
  {
    label: "upload",
    honest: () => makeUpload(3, "text/plain", "a.txt"),
    names: ["size", "type", "name"],
    impostors: [
      ["a Blob", () => new Blob(["abc"], { type: "text/plain" })],
      ["a File", () => new File(["abc"], "a.txt", { type: "text/plain" })],
      ["a Map", () => new Map([["size", 1]])],
      ["a Set", () => new Set([1, 2])],
      ["an Event", () => new Event("click")],
      ["a function", () => function upload() {}],
    ],
  },
  {
    label: "answer",
    honest: () => makeAnswer(200, true, "OK"),
    names: ["status", "ok", "statusText"],
    impostors: [
      ["a Response", () => new Response("body", { status: 201, statusText: "Created" })],
      ["a Response that failed", () => new Response(null, { status: 404 })],
      ["Response.error()", () => Response.error()],
      ["a subclass of Response with its own status", () => new (class extends Response { get status() { return "overridden"; } })("x")],
      ["a Request", () => new Request("http://example.com/")],
    ],
  },
  {
    label: "failure",
    honest: () => makeFailure("Failure", "it failed"),
    names: ["name", "message", "code"],
    impostors: [
      ["an Error", () => new Error("it broke")],
      ["a RangeError", () => new RangeError("out of range")],
      ["a DOMException", () => new DOMException("not found", "NotFoundError")],
      ["an AggregateError", () => new AggregateError([], "many")],
      ["an error with a code", () => Object.assign(new Error("coded"), { code: "ECODE" })],
      ["a class", () => class Failure {}],
    ],
  },
];

for (const family of families) {
  const uses = [
    ["own", thing => family.names.map(name => Object.hasOwn(thing, name))],
    ["keys", thing => Object.keys(thing)],
    ["for-in", thing => { const names = []; for (const name in thing) if (family.names.includes(name)) names.push(name); return names; }],
    ["spread", thing => Object.keys({ ...thing })],
  ];
  const direct = {
    address: [thing => thing.host, thing => thing.port, thing => thing.pathname, thing => { thing.port = 9090; return [thing.port, thing.host]; }, ({ host, port }) => [host, port]],
    upload: [thing => thing.size, thing => thing.type, thing => thing.name, thing => { thing.size = 99; return thing.size; }, ({ size, type }) => [size, type]],
    answer: [thing => thing.status, thing => thing.ok, thing => thing.statusText, thing => { thing.status = 500; return [thing.status, thing.ok]; }, ({ status, ok }) => [status, ok]],
    failure: [thing => thing.name, thing => thing.message, thing => thing.code, thing => { thing.message = "changed"; return [thing.message, String(thing)]; }, ({ name, message }) => [name, message]],
  }[family.label];
  direct.forEach((use, index) => uses.push(["by name " + index, use]));

  for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(family.honest());

  for (const [label, make] of [["honest", family.honest], ...family.impostors, ["honest again", family.honest]]) {
    for (const [name, use] of uses) {
      let line = family.label + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(make()));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
}
