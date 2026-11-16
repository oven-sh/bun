// Whether a control character is let through in the value of a header hangs on two options. A program lays one on the response itself, in each way in which a property can come to lie there, in front of the first header.
import http from "node:http";
import net from "node:net";

const ask = async (server, paths) => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = net.connect(server.address().port, "127.0.0.1");
  client.setEncoding("latin1");
  let arrived = "";
  let whole = () => {};
  client.on("data", part => {
    arrived += part;
    if (arrived.endsWith("ok")) whole();
  });
  for (const path of paths) {
    arrived = "";
    await new Promise(resolve => {
      whole = resolve;
      client.write("GET " + path + " HTTP/1.1\r\nHost: a\r\n\r\n");
    });
    console.log("  on the wire:", JSON.stringify(arrived.split("\r\n").filter(line => line.startsWith("x-"))));
  }
  client.destroy();
  await new Promise(resolve => server.close(resolve));
};
const answer = (label, res, undo) => {
  let seen;
  try {
    res.setHeader("x-odd", "a\u0001b");
    seen = "taken";
  } catch (error) {
    seen = error.code;
  }
  console.log(label, "|", seen);
  if (typeof undo === "function") undo();
  res.end("ok");
};

const ways = {
  "nothing is laid": () => {},
  "a store by name": res => (res.httpValidation = "relaxed"),
  "a store of the other name": res => (res.insecureHTTPParser = true),
  "a store that says strict over a lenient server": res => (res.httpValidation = "strict"),
  "a store under a name made at run time": res => (res[["http", "Validation"].join("")] = "relaxed"),
  "an accessor": res => Object.defineProperty(res, "httpValidation", { get: () => "relaxed", configurable: true }),
  "a copy from another object": res => Object.assign(res, { insecureHTTPParser: true }),
  "another property alone": res => (res.locals = {}),
  "an object laid between that holds it": res =>
    Object.setPrototypeOf(res, Object.create(Object.getPrototypeOf(res), { httpValidation: { value: "relaxed" } })),
  "an object laid between that holds nothing": res =>
    Object.setPrototypeOf(res, Object.create(Object.getPrototypeOf(res))),
  "another request under req": res => {
    const req = res.req;
    res.req = { socket: { server: { httpValidation: "relaxed" } } };
    return () => (res.req = req);
  },
  "no request under req": res => {
    const req = res.req;
    res.req = null;
    return () => (res.req = req);
  },
};
const names = Object.keys(ways);
for (const options of [{}, { insecureHTTPParser: true }]) {
  console.log("a server made with", JSON.stringify(options));
  await ask(
    http.createServer(options, (req, res) => {
      const name = names[Number(req.url.slice(1))];
      answer(name, res, ways[name](res));
    }),
    names.map((_, index) => "/" + index),
  );
}
