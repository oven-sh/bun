// The cases that CASES names, a line each, one after another (a case is "<name> . <answer> . <deed>"; without CASES the cases are listed): the second request of a connection gets an accessor of the program's under one name, on the request itself.
// It hands on what lay there, and throws the first time that it is asked, or never. What the client got, what the request emitted and what escaped are printed.
import http from "node:http";
import net from "node:net";

const names = [
  "_destroy",
  "_dump",
  "_read",
  "destroy",
  "emit",
  "listenerCount",
  "push",
  "read",
  "removeAllListeners",
  "resume",
  "_dumped",
  "complete",
  "writable",
  "_writableState",
  "_readableState",
  "_consuming",
  "_events",
  "_eventsCount",
  "readableEnded",
  "destroyed",
  "aborted",
  "readable",
  "on",
];
const answers = {
  "end with a text": { handle: (req, res) => res.end("ok") },
  "the body by listeners": {
    body: "x".repeat(100),
    handle(req, res) {
      let length = 0;
      req.on("data", part => (length += part.length));
      req.on("end", () => res.end("ok" + length));
    },
  },
  "the body is left alone": { body: "x".repeat(100), handle: (req, res) => res.end("ok") },
  "the body by readable and read": {
    body: "x".repeat(100),
    handle(req, res) {
      let length = 0;
      req.on("readable", () => {
        for (let part = req.read(); part !== null; part = req.read()) length += part.length;
      });
      req.on("end", () => res.end("ok" + length));
    },
  },
};
const deeds = ["only answers", "throws once"];
const cases = [];
for (const name of names)
  for (const answer in answers) for (const deed of deeds) cases.push(`${name} . ${answer} . ${deed}`);
if (!process.env.CASES) {
  console.log(cases.join("\n"));
  process.exit(0);
}
// Runs the event loop that many times: jobs, errors that nobody handles and what has arrived run each time, and no clock decides.
const spinEventLoop = async (count = 20) => {
  while (count-- > 0) await new Promise(done => setImmediate(done));
};
// What escapes is booked to the case that runs.
let seen = [];
process.on("uncaughtException", error => seen.push("escaped: " + error.message));
// The cases stand in a loop at the top level: in a function of their own the build compiled a question of the library about a request, isResumeUnheard, otherwise.
for (const title of process.env.CASES.split("\n")) {
  const [name, answer, deed] = title.split(" . ");
  const said = (seen = []);
  let requests = 0;
  const emit = http.IncomingMessage.prototype.emit;
  const server = http.createServer((req, res) => {
    if (++requests === 2) {
      let armed = deed === "throws once";
      const own = Object.getOwnPropertyDescriptor(req, name);
      let held = own && "value" in own ? own.value : undefined;
      const above = Object.getPrototypeOf(req);
      Object.defineProperty(req, name, {
        get() {
          if (armed) {
            armed = false;
            throw new Error("the accessor throws");
          }
          return own ? held : Reflect.get(above, name, this);
        },
        set(value) {
          if (own) held = value;
          else Reflect.set(above, name, value, this);
        },
        configurable: true,
        enumerable: true,
      });
    }
    try {
      answers[answer].handle(req, res);
    } catch (error) {
      said.push("thrown in the handler: " + error.message);
      try {
        res.end("ok");
      } catch (second) {
        said.push("thrown at the end: " + second.message);
      }
    }
  });
  server.on("clientError", error => said.push("clientError " + error.code));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  client.setEncoding("latin1");
  client.on("error", error => said.push("the client: " + error.code));
  let arrived = "";
  let whole = () => {};
  client.on("data", part => {
    arrived += part;
    if (/\r\n\r\nok\d*$/.test(arrived)) whole();
  });
  const closed = new Promise(resolve => client.on("close", resolve));
  client.on("close", () => (said.push("the connection closes"), whole()));
  const body = answers[answer].body;
  console.log(title);
  for (let i = 0; i < 3 && !client.destroyed; i++) {
    arrived = "";
    await new Promise(resolve => {
      whole = resolve;
      // An answer that does not come has no event.
      setTimeout(resolve, 400);
      client.write(
        body
          ? `POST / HTTP/1.1\r\nHost: a\r\nContent-Length: ${body.length}\r\n\r\n${body}`
          : "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
      );
    });
    await spinEventLoop();
    // A connection that is being closed is waited for: its event comes some turns behind the one that tells of it.
    if (client.destroyed || said.some(word => word.startsWith("clientError"))) {
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    console.log(
      "  request",
      i + 1,
      "|",
      JSON.stringify(arrived.split("\r\n")[0]),
      JSON.stringify(arrived.split("\r\n\r\n")[1] ?? ""),
      "|",
      said.splice(0).join(", "),
    );
  }
  client.destroy();
  server.closeAllConnections();
  await Promise.all([closed, new Promise(resolve => server.close(resolve))]);
}
process.exit(0);
