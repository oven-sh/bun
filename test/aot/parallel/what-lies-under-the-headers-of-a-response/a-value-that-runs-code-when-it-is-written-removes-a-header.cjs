// A header's value may run code of the program when it is written: a trap of a Proxy, a join() or a toString() of its own. A header that this code removes, and that has not been written yet, does not go over the wire.
const http = require("node:http");
const net = require("node:net");

const values = {
  "a Proxy round a list, at its length"(res, isArmed) {
    return new Proxy(["1", "2"], {
      get(target, key) {
        if (isArmed() && key === "length") res.removeHeader("X-Later");
        return Reflect.get(target, key);
      },
    });
  },
  "a Proxy round a list, at an element"(res, isArmed) {
    return new Proxy(["1", "2"], {
      get(target, key) {
        if (isArmed() && key === "1") res.removeHeader("X-Later");
        return Reflect.get(target, key);
      },
    });
  },
  "a list with a join of its own"(res, isArmed) {
    const list = ["a=1", "c=2"];
    list.join = () => {
      if (isArmed()) res.removeHeader("X-Later");
      return "joined";
    };
    return list;
  },
  "a list below a prototype with a join"(res, isArmed) {
    const list = ["a=1", "c=2"];
    Object.setPrototypeOf(list, {
      __proto__: Array.prototype,
      join() {
        if (isArmed()) res.removeHeader("X-Later");
        return "joined above";
      },
    });
    return list;
  },
  "a list of a class of the program's"(res, isArmed) {
    class Made extends Array {
      join() {
        if (isArmed()) res.removeHeader("X-Later");
        return "joined by the class";
      }
    }
    return Made.from(["a=1", "c=2"]);
  },
  "a list that holds an object"(res, isArmed) {
    return [
      "1",
      {
        toString() {
          if (isArmed()) res.removeHeader("X-Later");
          return "text";
        },
      },
    ];
  },
  "a plain list"() {
    return ["1", "2"];
  },
};

function run(make, name) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let armed = false;
      try {
        res.setHeader(name, make(res, () => armed));
        res.setHeader("X-Later", "later");
      } catch (error) {
        res.setHeader("X-Thrown", error.code ?? error.constructor.name);
      }
      armed = true;
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      let text = "";
      const client = net.connect(server.address().port, "127.0.0.1");
      client.on("data", chunk => (text += chunk));
      client.on("error", () => {});
      client.on("close", () => {
        server.close();
        resolve(
          text
            .split("\r\n")
            .filter(line => /^(x-|cookie)/i.test(line))
            .join(" | "),
        );
      });
      client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
    });
  });
}

(async () => {
  for (const [label, make] of Object.entries(values)) {
    for (const name of ["X-First", "Cookie"]) console.log(label, "under", name, ":", await run(make, name));
  }
  process.exit(0);
})();
