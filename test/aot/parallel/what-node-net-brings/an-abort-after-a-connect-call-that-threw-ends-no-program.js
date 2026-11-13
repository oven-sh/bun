// node:net listens for the 'error' of a socket that it makes with a signal. The program never has the socket of a connect call that throws,
// so the abort that follows must end no program: the text of node:net that the compiler reads does what plain Bun does.
const net = require("node:net");
const controller = new AbortController();
try {
  net.connect({ host: "127.0.0.1", port: 70000, signal: controller.signal });
  console.log("made");
} catch (error) {
  console.log(error.code);
}
controller.abort();
process.on("exit", code => console.log("exit code", code));
