// When the body of a request is first asked for, `req._readableState.readingMore = false` is stored by name.
// What a program lays under that name, on the state or on an object between the state and its class, takes the store: a setter runs, a value is overwritten,
// and what takes no store throws: where somebody reads the body the request is destroyed and the client gets no answer.
// Each row has a connection of its own that is kept for three requests: the first request of a connection goes another way than those behind it.
// The accessor of the library on the prototype of the state is not configurable: nobody replaces or deletes it.
const http = require("node:http");
const net = require("node:net");
const laid = {
  "a value": () => ({ configurable: true, writable: true, value: "laid" }),
  "a setter": note => ({ configurable: true, get: () => "held", set: note }),
  "a value that takes no store": () => ({ configurable: true, writable: false, value: "laid" }),
  "a getter alone": () => ({ configurable: true, get: () => "held" }),
};
const places = {
  "on the state": (state, descriptor) => Object.defineProperty(state, "readingMore", descriptor),
  "in between": (state, descriptor) =>
    Object.setPrototypeOf(state, Object.create(Object.getPrototypeOf(state), { readingMore: descriptor })),
};
const handlers = {
  "nobody reads": (req, res) => void res.end("ok"),
  "nobody reads and the end of the response is heard": (req, res) => void res.on("finish", () => {}).end("ok"),
  "a listener for data": (req, res) => {
    let got = "";
    req.on("data", piece => (got += piece));
    req.on("end", () => res.end("got " + got));
  },
  "for await": async (req, res) => {
    let got = "";
    for await (const piece of req) got += piece;
    res.end("got " + got);
  },
};
const rows = [];
for (const handler in handlers)
  for (const method of ["GET", "POST"]) for (const place in places) for (const what in laid) rows.push({ handler, method, place, what });

let row;
let notes = [];
let states = [];
process.on("uncaughtException", error => notes.push("uncaught " + error.name + ": " + error.message));
const server = http.createServer((req, res) => {
  const state = req._readableState;
  states.push(state);
  places[row.place](
    state,
    laid[row.what](value => notes.push("stored " + value)),
  );
  handlers[row.handler](req, res)?.catch(error => notes.push("rejected " + error.name + ": " + error.message));
});
function show(state) {
  const own = Object.getOwnPropertyDescriptor(state, "readingMore");
  return `reads ${state.readingMore}, own ${own && "value" in own ? own.value : own && "an accessor"}`;
}
function next() {
  if (rows.length === 0) return void server.close();
  row = rows.shift();
  notes = [];
  states = [];
  const answers = [];
  let answer = "";
  const client = net.connect(server.address().port, "127.0.0.1", send);
  function send() {
    client.write(
      row.method === "GET" ? "GET / HTTP/1.1\r\nHost: a\r\n\r\n" : "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 6\r\n\r\nposted",
    );
  }
  client.on("data", piece => {
    answer += piece.toString("latin1");
    const at = answer.indexOf("\r\n\r\n");
    if (at < 0 || answer.length < at + 4 + Number(/content-length: (\d+)/i.exec(answer)[1])) return;
    answers.push(answer.slice(9, 12) + " " + answer.slice(at + 4));
    answer = "";
    if (answers.length < 3) setTimeout(send, 2);
    else setTimeout(() => client.destroy(), 2);
  });
  client.on("error", error => notes.push("client " + error.code));
  client.on("close", () =>
    setTimeout(() => {
      console.log(`${row.handler}, ${row.method}, ${row.what} ${row.place}: ${states.map(show).join(" | ")} . answers ${answers.join(" | ") || "none"} . ${notes.join(" . ")}`);
      next();
    }, 2),
  );
}
server.listen(0, "127.0.0.1", next);
