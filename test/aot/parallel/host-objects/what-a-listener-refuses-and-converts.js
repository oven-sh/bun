// What Bun.listen refuses, and what its messages say: one of them describes the value, so code of the program runs for it. A name of the host and a port are converted, and a key that is no list is iterated.
let ran = 0;
const odd = Object.create(null);
odd[Symbol.for("nodejs.util.inspect.custom")] = () => {
  ran++;
  return "custom text";
};
const named = {
  constructor: {
    get name() {
      ran += 10;
      return "Named";
    },
  },
};
const socket = { data() {} };
for (const options of [
  { hostname: "127.0.0.1", port: 0, socket, tls: { secureContext: odd } },
  { hostname: "127.0.0.1", port: 0, socket, tls: { secureContext: named } },
  { hostname: "127.0.0.1", port: 0, socket: { data: odd } },
  { hostname: "127.0.0.1", port: 0, socket: odd },
  { hostname: odd, port: 0, socket },
  { hostname: "127.0.0.1", port: odd, socket },
  { unix: odd, socket },
  { hostname: "127.0.0.1", port: 0, socket, tls: { key: odd } },
  { hostname: "127.0.0.1", port: 0, socket, tls: { key: [odd] } },
  { hostname: "127.0.0.1", port: 0, socket, allowHalfOpen: named },
  { hostname: "127.0.0.1", port: 0, socket: { data() {}, binaryType: named } },
  odd,
  1,
]) {
  try {
    Bun.listen(options).stop(true);
    console.log("listens");
  } catch (error) {
    console.log(error.name, error.code, String(error.message).slice(0, 110));
  }
}

try {
  Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket,
    tls: {
      key: {
        *[Symbol.iterator]() {
          ran += 100;
        },
      },
    },
  }).stop(true);
} catch {
  ran += 1000;
}
Bun.listen({
  hostname: {
    toString() {
      ran += 10000;
      return "127.0.0.1";
    },
  },
  port: {
    valueOf() {
      ran += 100000;
      return 0;
    },
  },
  socket,
}).stop(true);
console.log(ran);
