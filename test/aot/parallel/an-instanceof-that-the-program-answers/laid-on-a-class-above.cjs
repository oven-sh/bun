// Symbol.hasInstance laid on a class of the library is found by instanceof on every class below it.
const http = require("node:http");
const { Readable, Stream } = require("node:stream");
const EventEmitter = require("node:events");

const request = new http.IncomingMessage(null);
const response = new http.ServerResponse(request);

function ask(label) {
  console.log(
    label,
    request instanceof http.IncomingMessage,
    request instanceof Readable,
    request instanceof Stream,
    request instanceof EventEmitter,
    response instanceof http.ServerResponse,
    response instanceof http.OutgoingMessage,
  );
}

function lay(holder, answer) {
  Object.defineProperty(holder, Symbol.hasInstance, { configurable: true, value: () => answer });
}

ask("untouched");
lay(Readable, false);
ask("no on Readable");
delete Readable[Symbol.hasInstance];
ask("taken away");
lay(Stream, false);
ask("no on Stream");
delete Stream[Symbol.hasInstance];
lay(EventEmitter, false);
ask("no on EventEmitter");
delete EventEmitter[Symbol.hasInstance];
lay(http.OutgoingMessage, false);
ask("no on OutgoingMessage");
delete http.OutgoingMessage[Symbol.hasInstance];
ask("all taken away");
lay(Readable, true);
console.log("a text under yes on Readable", "text" instanceof http.IncomingMessage, "text" instanceof Readable);
