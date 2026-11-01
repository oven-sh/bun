// Logs every Proxy trap that node:http triggers on a request, its socket, and the server during live requests.
const http = require("node:http");
const net = require("node:net");
require("node:stream");

function keyText(key) {
  return typeof key === "symbol" ? "[" + String(key.description) + "]" : key;
}

let traps = [];
function createLoggingProxy(target) {
  const handler = {
    get(target, key) {
      traps.push(keyText(key));
      return Reflect.get(...arguments);
    },
    set(target, key) {
      traps.push("set " + keyText(key));
      const answer = Reflect.set(...arguments);
      const text = keyText(key);
      if (traps.at(-1) === "defineProperty " + text && traps.at(-2) === "getOwnPropertyDescriptor " + text) traps.length -= 2;
      return answer;
    },
  };
  for (const trap of ["has", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty"]) {
    handler[trap] = function (target, key) {
      traps.push(trap + " " + keyText(key));
      return Reflect[trap](...arguments);
    };
  }
  for (const trap of ["getPrototypeOf", "ownKeys", "isExtensible", "preventExtensions", "setPrototypeOf"]) {
    handler[trap] = function () {
      traps.push(trap);
      return Reflect[trap](...arguments);
    };
  }
  return new Proxy(target, handler);
}

function describe(value, receiver) {
  if (value === receiver && value !== undefined) return "this";
  if (value === null) return "null";
  if (typeof value === "object") {
    if (value instanceof Promise) value.catch(() => {});
    return "object";
  }
  if (typeof value === "function") return "function";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return String(value);
}
function describeError(error) {
  return "throws " + (error?.name ?? typeof error) + (error?.code !== undefined ? " " + error.code : "");
}
function formatTraps(list) {
  if (list.length <= 48) return list.join(", ");
  let sum = 0x811c9dc5;
  for (let index = 48; index < list.length; index++) {
    const text = list[index];
    for (let at = 0; at < text.length; at++) sum = Math.imul(sum ^ text.charCodeAt(at), 0x01000193);
    sum = Math.imul(sum ^ 44, 0x01000193);
  }
  return list.slice(0, 48).join(", ") + ", +" + (list.length - 48) + " more (" + (sum >>> 0).toString(16) + ")";
}

const turn = () => new Promise(resolve => setImmediate(resolve));
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

const groups = new Map();
function print(subject, which, text) {
  let group = groups.get(subject);
  if (group === undefined) groups.set(subject, (group = new Map()));
  const cases = group.get(text);
  if (cases === undefined) group.set(text, [which]);
  else cases.push(which);
}

function exchange(port, text) {
  return new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    let answer = "";
    const timer = setTimeout(() => socket.destroy(), 5000);
    socket.on("data", chunk => (answer += chunk));
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(JSON.stringify(answer.split("\r\n")[0]));
    });
    socket.write(text);
  });
}
const requests = {
  GET: "GET /a HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n",
  POST: "POST /a HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 5\r\n\r\nhello",
};
const lists = {
  "()": () => [],
  '("a", 1)': () => ["a", 1],
  "(bytes, callback)": () => [Buffer.from("b"), function callback() {}],
};

function collectMembers(sample, wanted) {
  const members = [];
  for (let level = Object.getPrototypeOf(sample); level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const key of Reflect.ownKeys(level)) {
      if (key === "constructor" || members.some(member => member[0] === key)) continue;
      if (wanted !== undefined && !wanted.includes(key)) continue;
      members.push([key, Reflect.getOwnPropertyDescriptor(level, key)]);
    }
  }
  return members;
}
function getInvocations(descriptor) {
  const invocations = [];
  if (typeof descriptor.get === "function") invocations.push(["get", receiver => descriptor.get.call(receiver)]);
  if (typeof descriptor.set === "function") invocations.push(["set", receiver => descriptor.set.call(receiver, 1)]);
  if (typeof descriptor.value === "function") {
    for (const list of Object.keys(lists)) invocations.push([list, receiver => descriptor.value.apply(receiver, lists[list]())]);
  }
  return invocations;
}

async function testLiveObject(what, pick, wanted) {
  let job;
  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    job(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let members;
  job = (req, res) => {
    members = collectMembers(pick(req), wanted);
    res.end();
  };
  await exchange(port, requests.GET);
  for (const [key, descriptor] of members) {
    if (key === "ref" || key === "unref") continue;
    for (const [way, enter] of getInvocations(descriptor)) {
      for (const method of Object.keys(requests)) {
        for (const when of ["before res.end()", "after res.end()"]) {
          let text = "no request event";
          let now = [];
          job = (req, res) => {
            const connection = req.socket;
            if (when !== "before res.end()") res.end("early");
            const receiver = createLoggingProxy(pick(req));
            traps = [];
            try {
              text = describe(enter(receiver), receiver);
            } catch (error) {
              text = describeError(error);
            }
            now = traps;
            traps = [];
            setImmediate(() => {
              try {
                if (!res.writableEnded) res.end("late");
              } catch {}
              setImmediate(() => connection.destroy());
            });
          };
          traps = [];
          const answer = await exchange(port, requests[method]);
          for (let index = 0; index < 3; index++) await turn();
          const later = traps;
          traps = [];
          print(what + " " + keyText(key) + " " + way, method + " " + when, text + ", answered " + answer + (now.length ? " | " + formatTraps(now) : "") + (later.length ? " | later " + formatTraps(later) : ""));
        }
      }
    }
  }
  await new Promise(resolve => server.close(resolve));
}

async function testServerProxy() {
  const kinds = {
    ...requests,
    "pipelined": "GET /a HTTP/1.1\r\nHost: h\r\n\r\nGET /b HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n",
    "HTTP/1.0": "GET /a HTTP/1.0\r\n\r\n",
    "no host": "GET /a HTTP/1.1\r\nConnection: close\r\n\r\n",
    "expect continue": "POST /a HTTP/1.1\r\nHost: h\r\nConnection: close\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\nhi",
    chunked: "POST /a HTTP/1.1\r\nHost: h\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nhi\r\n0\r\n\r\n",
  };
  for (const options of [undefined, { uniqueHeaders: ["x-a"] }, { optimizeEmptyRequests: true }, { joinDuplicateHeaders: true }, { maxRequestsPerSocket: 1 }]) {
    const subject = "createServer " + JSON.stringify(options ?? null);
    const real = options === undefined ? http.createServer() : http.createServer(options);
    real.on("request", (req, res) => {
      req.resume();
      res.end("ok");
    });
    const server = createLoggingProxy(real);
    traps = [];
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    for (let index = 0; index < 3; index++) await turn();
    print(subject, "listen", formatTraps(traps));
    const port = real.address().port;
    for (const kind of Object.keys(kinds)) {
      traps = [];
      const answer = await exchange(port, kinds[kind]);
      for (let index = 0; index < 3; index++) await turn();
      print(subject, kind, "answered " + answer + " | " + formatTraps(traps));
    }
    traps = [];
    await new Promise(resolve => server.close(resolve));
    for (let index = 0; index < 3; index++) await turn();
    print(subject, "close", formatTraps(traps));
  }
}

async function testDetachedMessages() {
  for (const [key, descriptor] of collectMembers(new http.IncomingMessage(new net.Socket()))) {
    for (const [way, enter] of getInvocations(descriptor)) {
      for (const [which, target] of [
        ["{}", () => ({})],
        ["Object.create(prototype)", () => Object.create(http.IncomingMessage.prototype)],
        ["new IncomingMessage(socket)", () => new http.IncomingMessage(new net.Socket()).on("error", () => {})],
      ]) {
        const receiver = createLoggingProxy(target());
        traps = [];
        let text;
        try {
          text = describe(enter(receiver), receiver);
        } catch (error) {
          text = describeError(error);
        }
        const now = traps;
        traps = [];
        for (let index = 0; index < 4; index++) await turn();
        const later = traps;
        traps = [];
        print("IncomingMessage " + keyText(key) + " " + way, which, text + (now.length ? " | " + formatTraps(now) : "") + (later.length ? " | later " + formatTraps(later) : ""));
      }
    }
  }
}

(async function () {
  await testDetachedMessages();
  await testLiveObject("req", req => req);
  await testLiveObject("req.socket", req => req.socket, ["_write", "_writev", "_final", "_destroy", "write", "end", "destroy", "destroySoon", "bytesWritten", "destroyed", "setTimeout"]);
  await testServerProxy();
  const lines = [];
  for (const [subject, group] of groups) {
    for (const [text, cases] of group) lines.push(subject + " [" + cases.join("; ") + "]: " + text);
  }
  console.log(lines.join("\n"));
  process.exit(0);
})();
