// A connect call refuses a host with a null byte before node:net resolves it: the text of node:net that the compiler reads throws what plain Bun throws.
const net = require("node:net");
const tls = require("node:tls");
const host = "127.0.0.1\u0000.allowed.example";
for (const [name, connect] of [
  ["net", net.connect],
  ["tls", tls.connect],
]) {
  try {
    connect({ host, port: 0 });
    console.log(name, "made");
  } catch (error) {
    console.log(name, error.code, error.message);
  }
}
