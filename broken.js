const EventEmitter = require("events").EventEmitter;
const ogEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (...args) {
  console.log(...args);
  return ogEmit.apply(this, args);
};

const { duplexPair } = require("node:stream");
const tls = require("node:tls");
const [clientSide] = duplexPair();

const fixtures = require("./test/js/node/test/common/fixtures");
const ca = fixtures.readKey("ca1-cert.pem");

const client = tls.connect({
  socket: clientSide,
  ca,
  host: "agent1", // Hostname from certificate
});
