// Options that a native function reads by name: plain, with accessors, inherited, deleted, on prototypes, frozen, of classes.
import net from "node:net";
const said = [];
const label = error => `${error.name} ${error.code ?? ""}`;
const handlers = () => ({ data() {}, open() {}, close() {}, error() {} });
class Handlers {
  data() {}
  open() {}
}
class HandlersWithFields {
  data = () => {};
  open = () => {};
}
class HandlersWithWrongField {
  data = () => {};
  open = 5;
}
const kindsOfHandlers = {
  plain: handlers,
  empty: () => ({}),
  wrong: () => ({ ...handlers(), open: 5 }),
  undefined: () => ({ ...handlers(), open: undefined }),
  null: () => ({ ...handlers(), open: null }),
  accessor: () => ({
    ...handlers(),
    get open() {
      said.push("get open");
      return 5;
    },
  }),
  throwing: () => ({
    ...handlers(),
    get drain() {
      throw new RangeError("drain");
    },
  }),
  "without prototype": () => Object.assign(Object.create(null), handlers()),
  "without prototype, wrong": () => ({ __proto__: null, data() {}, open: 5 }),
  inherited: () => Object.create(handlers()),
  "inherited, wrong": () => Object.create({ ...handlers(), open: 5 }),
  "inherited beside its own": () => ({ __proto__: { open: 5 }, data() {} }),
  deleted: () => {
    const all = { ...handlers(), open: 5 };
    delete all.open;
    return all;
  },
  added: () => {
    const all = handlers();
    for (const name of ["dr", "ti"]) all[name + (name === "dr" ? "ain" : "meout")] = 5;
    return all;
  },
  frozen: () => Object.freeze({ ...handlers(), open: 5 }),
  class: () => new Handlers(),
  "class with fields": () => new HandlersWithFields(),
  "class with a wrong field": () => new HandlersWithWrongField(),
  proxy: () =>
    new Proxy(handlers(), {
      get(target, name) {
        said.push("get " + String(name));
        return target[name];
      },
    }),
  function: () => Object.assign(() => {}, handlers()),
  array: () => Object.assign([], handlers()),
};
const kindsOfOptions = {
  literal: socket => ({ hostname: "127.0.0.1", port: 0, socket }),
  spread: socket => ({ ...{ hostname: "127.0.0.1", port: 0 }, socket }),
  "wrong port": socket => ({ hostname: "127.0.0.1", port: "nothing", socket }),
  "accessor of a port": socket => ({
    hostname: "127.0.0.1",
    socket,
    get port() {
      said.push("get port");
      return 0;
    },
  }),
  "inherited socket": socket => ({ __proto__: { socket }, hostname: "127.0.0.1", port: 0 }),
  "no host": socket => ({ port: 0, socket }),
};
for (const options in kindsOfOptions) {
  for (const kind in kindsOfHandlers) {
    said.length = 0;
    try {
      const server = Bun.listen(kindsOfOptions[options](kindsOfHandlers[kind]()));
      said.push("listens " + (server.port > 0));
      server.stop(true);
    } catch (error) {
      said.push(label(error));
    }
    console.log(options, "|", kind, "|", said.join(" . "));
  }
}
const server = net.createServer(socket => socket.end("answer"));
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  const ways = {
    literal: () => ({ port, host: "127.0.0.1", noDelay: true }),
    inherited: () => Object.create({ port, host: "127.0.0.1" }),
    accessors: () => ({
      get port() {
        return port;
      },
      host: "127.0.0.1",
    }),
    "without prototype": () => ({ __proto__: null, port, host: "127.0.0.1", keepAlive: true }),
    "half open": () => ({ port, host: "127.0.0.1", allowHalfOpen: true }),
  };
  for (const way in ways) {
    const text = await new Promise(resolve => {
      let got = "";
      const socket = net.connect(ways[way]());
      socket.on("data", chunk => (got += chunk));
      socket.on("error", error => resolve(label(error)));
      socket.on("end", () => {
        socket.end();
        resolve(got);
      });
    });
    console.log(way, text);
  }
  server.close();
});
