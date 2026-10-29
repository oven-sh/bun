// `captureRejections` in the options of an OutgoingMessage or a ServerResponse does nothing, as in node: EventEmitter is handed no options.
import { EventEmitter } from "node:events";
import http from "node:http";

// An emitter that captures rejections calls then() of the promise that a listener returns.
function captures(emitter) {
  let called = false;
  const promise = Promise.resolve();
  promise.then = () => {
    called = true;
  };
  emitter.on("asked", () => promise);
  emitter.emit("asked");
  return called;
}
const request = () => ({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} });
class Message extends http.OutgoingMessage {}
class Response extends http.ServerResponse {}
function Called(req, options) {
  http.ServerResponse.call(this, req, options);
}
Object.setPrototypeOf(Called.prototype, http.ServerResponse.prototype);

for (const [label, make] of [
  ["new OutgoingMessage", options => new http.OutgoingMessage(options)],
  ["a class that extends OutgoingMessage", options => new Message(options)],
  ["new ServerResponse", options => new http.ServerResponse(request(), options)],
  ["a class that extends ServerResponse", options => new Response(request(), options)],
  ["ServerResponse called on an object", options => new Called(request(), options)],
]) {
  for (const captureRejections of [true, "yes"]) {
    let answer;
    try {
      answer = captures(make({ captureRejections }));
    } catch (error) {
      answer = error.code;
    }
    console.log(`${label}, captureRejections ${JSON.stringify(captureRejections)}: ${answer}`);
  }
  EventEmitter.captureRejections = true;
  try {
    console.log(`${label}, while EventEmitter.captureRejections is true: ${captures(make())}`);
  } finally {
    EventEmitter.captureRejections = false;
  }
}
