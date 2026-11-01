// In a live exchange, objects that are no responses but hold what the response holds are written to, ended, destroyed and asked: a copy below the prototype object of responses, a spread response, a plain object with the handle alone. Then servers whose responses are made by a constructor of the program: one that never calls the constructor of responses, and ones that answer a proxy, an heir or a copy of a response. Each turn prints what every call answers and what the client reads.
const http = require("node:http");
const net = require("node:net");
const lines = [];
const print = line => void lines.push(line);

const textOfKey = key => (typeof key === "symbol" ? `[${key.description}]` : key);
function textOfError(error) {
  // The engine quotes the text of the library in these.
  const message = String(error.message)
    .split("\n")[0]
    .replace(/ \(evaluating '.*$/, "")
    .replace(/^.* is not a (function|constructor).*$/, "what is called is not a $1");
  return `${error.name}${error.code === undefined ? "" : ` ${error.code}`}: ${message}`;
}
function attempt(label, body) {
  try {
    const value = body();
    const isObject = typeof value === "object" && value !== null;
    print(`${label}: ${isObject ? `object ${Object.getPrototypeOf(value)?.constructor?.name}` : `${typeof value} ${String(value)}`}`);
  } catch (error) {
    print(`${label}: throws ${textOfError(error)}`);
  }
}
process.on("uncaughtException", error => print(`later: ${textOfError(error)}`));

const prototype = http.ServerResponse.prototype;
const copyOf = res => Object.assign(Object.create(prototype), res);
const call = (name, receiver, ...list) => prototype[name].apply(receiver, list);
const read = (name, receiver) => Reflect.get(prototype, name, receiver);
const asked = [
  "headersSent",
  "writableNeedDrain",
  "writableFinished",
  "writableCorked",
  "writableEnded",
  "finished",
  "destroyed",
  "closed",
  "statusCode",
  "statusMessage",
  "shouldKeepAlive",
  "chunkedEncoding",
];
function ask(label, receiver) {
  for (const name of asked) attempt(`${label} ${name}`, () => read(name, receiver));
  for (const name of ["socket", "writableLength", "writableHighWaterMark"]) {
    attempt(`${label} ${name}`, () => typeof read(name, receiver));
  }
  attempt(`${label} getHeaders`, () => JSON.stringify(call("getHeaders", receiver)));
}

const turns = {
  "a copy ends"(req, res) {
    const copy = copyOf(res);
    ask("before", copy);
    attempt("end", () => copy.end("ended by a copy"));
    ask("after", copy);
    ask("the response", res);
  },
  "a copy sets a header, writes the head, writes and ends"(req, res) {
    const copy = copyOf(res);
    attempt("setHeader", () => copy.setHeader("x-one", "1"));
    attempt("appendHeader", () => copy.appendHeader("x-one", "2"));
    attempt("writeHead", () => copy.writeHead(201, "Made", { "x-two": "2" }));
    attempt("setHeader late", () => copy.setHeader("x-three", "3"));
    attempt("write", () => copy.write("first,"));
    ask("between", copy);
    attempt("write with a callback", () => copy.write("second,", () => print("the callback of write runs")));
    attempt("end", () => copy.end("last", () => print("the callback of end runs")));
    ask("after", copy);
    ask("the response", res);
  },
  "a spread response is entered by the methods of the prototype object"(req, res) {
    const spread = { ...res };
    attempt("setHeader", () => call("setHeader", spread, "x-one", "1"));
    attempt("writeHead", () => call("writeHead", spread, 202));
    attempt("flushHeaders", () => call("flushHeaders", spread));
    attempt("write", () => call("write", spread, "spread,"));
    attempt("end", () => call("end", spread, "done"));
    ask("after", spread);
    attempt("the response ends", () => res.end());
  },
  "a copy flushes the headers and the response ends"(req, res) {
    const copy = copyOf(res);
    attempt("setHeader", () => copy.setHeader("x-copy", "1"));
    attempt("flushHeaders", () => copy.flushHeaders());
    ask("the copy", copy);
    ask("the response", res);
    attempt("the response ends", () => res.end("by the response"));
  },
  "a copy is destroyed"(req, res) {
    const copy = copyOf(res);
    copy.on("close", () => print("the copy closes"));
    res.on("close", () => print("the response closes"));
    attempt("destroy", () => copy.destroy());
    ask("the copy", copy);
    ask("the response", res);
  },
  "a copy writes a continue, a processing and early hints"(req, res) {
    const copy = copyOf(res);
    attempt("writeContinue", () => copy.writeContinue());
    attempt("writeProcessing", () => copy.writeProcessing());
    attempt("writeEarlyHints", () => copy.writeEarlyHints({ link: "</a.css>; rel=preload" }));
    attempt("end", () => copy.end("after hints"));
  },
  "a copy corks, writes twice, uncorks and ends"(req, res) {
    const copy = copyOf(res);
    attempt("cork", () => copy.cork());
    attempt("write", () => copy.write("a"));
    attempt("write", () => copy.write("b"));
    attempt("uncork", () => copy.uncork());
    attempt("end", () => copy.end());
  },
  "a copy adds trailers"(req, res) {
    const copy = copyOf(res);
    attempt("setHeader", () => copy.setHeader("trailer", "x-last"));
    attempt("write", () => copy.write("body"));
    attempt("addTrailers", () => copy.addTrailers({ "x-last": "1" }));
    attempt("end", () => copy.end());
  },
  "a copy emits finish and close"(req, res) {
    const copy = copyOf(res);
    attempt("emit finish", () => copy.emit("finish"));
    attempt("emit close", () => copy.emit("close"));
    attempt("the response ends", () => res.end("still here"));
  },
  "the listeners of finish are called with other receivers"(req, res) {
    for (const listener of res.listeners("finish")) {
      attempt(`${listener.name} for {}`, () => listener.call({}));
      attempt(`${listener.name} for a copy`, () => listener.call(copyOf(res)));
    }
    attempt("the response ends", () => res.end("heard"));
  },
  "a plain object with the handle of the response"(req, res) {
    const handleKey = Object.getOwnPropertySymbols(res).find(key => key.description === "handle");
    const holder = { [handleKey]: res[handleKey], req };
    attempt("writeHead", () => call("writeHead", holder, 203, { "x-holder": "1" }));
    attempt("write", () => call("write", holder, "held,"));
    attempt("end", () => call("end", holder, "over"));
    print(`it holds ${Reflect.ownKeys(holder).map(textOfKey).join(" ")}`);
    attempt("the response ends", () => res.end());
  },
};

// The connection is closed behind every turn, so the client has read all there is when it sees the end.
function closeBehindTheTurn(req) {
  const socket = req.socket;
  setImmediate(() => setImmediate(() => setImmediate(() => socket?.destroySoon())));
}
function request(port, path) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    let text = "";
    socket.setEncoding("latin1");
    socket.on("data", chunk => (text += chunk));
    socket.on("error", () => {});
    socket.on("close", () => resolve(JSON.stringify(text.replace(/Date: [^\r]*/g, "Date: .."))));
    socket.write(`GET ${path} HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n`);
  });
}
const listening = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

function NeverCallsTheConstructor(req, options) {
  http.OutgoingMessage.call(this);
  this.req = req;
  for (const key of Object.getOwnPropertySymbols(options)) this[key] = options[key];
}
Object.setPrototypeOf(NeverCallsTheConstructor.prototype, prototype);
Object.setPrototypeOf(NeverCallsTheConstructor, http.ServerResponse);
function AnswersAProxy(req, options) {
  return new Proxy(new http.ServerResponse(req, options), {});
}
function AnswersAnHeir(req, options) {
  return Object.create(new http.ServerResponse(req, options));
}
function AnswersACopy(req, options) {
  return copyOf(new http.ServerResponse(req, options));
}
for (const constructor of [AnswersAProxy, AnswersAnHeir, AnswersACopy]) constructor.prototype = prototype;

(async () => {
  const names = Object.keys(turns);
  const server = http.createServer((req, res) => {
    closeBehindTheTurn(req);
    turns[names[Number(req.url.slice(1))]](req, res);
  });
  const port = await listening(server);
  for (let index = 0; index < names.length; index++) {
    print(`== ${names[index]}`);
    print(`the client reads ${await request(port, `/${index}`)}`);
  }
  server.close();
  for (const ServerResponse of [NeverCallsTheConstructor, AnswersAProxy, AnswersAnHeir, AnswersACopy]) {
    print(`== a server whose responses are made by ${ServerResponse.name}`);
    const other = http.createServer({ ServerResponse }, (req, res) => {
      closeBehindTheTurn(req);
      attempt("setHeader", () => res.setHeader("x-made-by", ServerResponse.name));
      attempt("write", () => res.write("written,"));
      attempt("end", () => res.end("ended"));
      attempt("headersSent", () => res.headersSent);
    });
    const port = await listening(other);
    print(`the client reads ${await request(port, "/")}`);
    print(`the client reads again ${await request(port, "/")}`);
    other.close();
  }
  setImmediate(() => process.stdout.write(lines.join("\n") + "\n", () => process.exit(0)));
})();
