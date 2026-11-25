// Object.setPrototypeOf(req, Object.create(Object.getPrototypeOf(req), { [name]: .. })), as express does to every request.
// `_writableState` is a name that a request lacks; `rawHeaders` is an accessor of its class. Quiet: the handler lays no listener and reads nothing.
const http = require("node:http");
const net = require("node:net");

const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? `list of ${value.length}` : String(value));

function hostOf(req) {
  try {
    return show(req.headers.host);
  } catch (error) {
    return error.constructor.name;
  }
}

function other(value) {
  if (Array.isArray(value)) return ["x-made-up", "1"];
  return typeof value === "object" && value !== null ? value : "made up";
}

function lay(req, name, deed, counts) {
  const above = Object.getPrototypeOf(req);
  let descriptor;
  if (deed === "function") descriptor = { value: () => "made up", writable: true, configurable: true };
  else if (deed === "getter") descriptor = { get: () => other(Reflect.get(above, name, req)), set() {}, configurable: true };
  else if (deed === "setter") descriptor = { get: () => Reflect.get(above, name, req), set: () => void counts.stored++, configurable: true };
  else descriptor = { value: other(above[name]), writable: false, configurable: true };
  Object.setPrototypeOf(req, Object.create(above, { [name]: descriptor }));
}

function ask(port, text, times) {
  return new Promise(resolve => {
    let answers = 0;
    let got = "";
    const client = net.connect(port, "127.0.0.1", () => client.write(text));
    client.on("data", chunk => {
      got += chunk;
      if (!got.endsWith("ok")) return;
      got = "";
      if (++answers < times) client.write(text);
      else client.end();
    });
    client.on("error", () => {});
    client.on("close", () => resolve(answers));
  });
}

async function row(name, deed, isQuiet, isPost) {
  const counts = { stored: 0 };
  const kept = [];
  const heard = [];
  const server = http.createServer((req, res) => {
    kept.push(req);
    lay(req, name, deed, counts);
    if (isQuiet) return void res.end("ok");
    req.on("data", () => {});
    req.on("end", () => heard.push("end"));
    req.on("close", () => heard.push("close"));
    if (isPost) req.on("end", () => res.end("ok"));
    else res.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const text = isPost ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello" : "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
  const answers = (await ask(server.address().port, text, 2)) + (await ask(server.address().port, text, 1));
  await new Promise(resolve => server.close(resolve));
  const flags = kept.map(req => `${show(req.complete)} ${show(req.destroyed)} ${show(req.readableEnded)} ${show(req.rawHeaders)} ${hostOf(req)}`);
  console.log(`${name} . ${deed} . ${isQuiet ? "quiet" : "heard"} . ${isPost ? "POST" : "GET"} | ${answers} answers . stored ${counts.stored > 0} . ${heard.join()} | ${flags.join(" | ")}`);
}

(async () => {
  for (const name of ["_writableState", "rawHeaders"])
    for (const deed of ["function", "getter", "setter", "fixed"])
      for (const isQuiet of [true, false]) for (const isPost of [false, true]) await row(name, deed, isQuiet, isPost);
})();
