// The map of headers of instances of classes below server response however they are made.
const http = require("node:http");
const net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");

const lines = [];
const show = value => JSON.stringify(value) ?? String(value);
const newMap = () => ({ __proto__: null, "x-two": ["X-Two", "2"], "x-list": ["X-List", ["a", "b"]] });
const request = () => new http.IncomingMessage(new net.Socket());

const Base = [http.ServerResponse, Object][process.argv.length > 99 ? 1 : 0];
class BaseChosenAtRunTime extends Base {}
const Evaluated = new Function("B", "return class Evaluated extends B {}")(http.ServerResponse);
const EvaluatedCaller = new Function(
  "B",
  "function EvaluatedCaller(a, b) { B.call(this, a, b); } Object.setPrototypeOf(EvaluatedCaller.prototype, B.prototype); return EvaluatedCaller;",
)(http.ServerResponse);
const mix = B =>
  class Mixed extends B {
    extra = 1;
  };
const Mixed = mix(http.ServerResponse);
const MixedTwice = mix(mix(http.ServerResponse));
function Other() {}
Object.setPrototypeOf(Other.prototype, http.ServerResponse.prototype);
function Stranger() {}
class Heir extends http.ServerResponse {}
const bound = Heir.bind(null);
const proxied = new Proxy(Heir, {});

const makers = {
  BaseChosenAtRunTime: () => new BaseChosenAtRunTime(request()),
  Evaluated: () => new Evaluated(request()),
  EvaluatedCaller: () => new EvaluatedCaller(request()),
  Mixed: () => new Mixed(request()),
  MixedTwice: () => new MixedTwice(request()),
  "constructed for a function below": () => Reflect.construct(http.ServerResponse, [request()], Other),
  "constructed for a stranger": () => Reflect.construct(http.ServerResponse, [request()], Stranger),
  "constructed for Object": () => Reflect.construct(http.ServerResponse, [request()], Object),
  "a bound heir": () => new bound(request()),
  "a proxied heir": () => new proxied(request()),
  "constructed for a proxy": () => Reflect.construct(http.ServerResponse, [request()], proxied),
  "called on a created object": () => {
    const object = Object.create(http.ServerResponse.prototype);
    http.ServerResponse.call(object, request());
    return object;
  },
  "called on a literal": () => {
    const object = { __proto__: http.ServerResponse.prototype, own: 1 };
    http.ServerResponse.call(object, request());
    return object;
  },
  "called on a response": () => {
    const object = new http.ServerResponse(request());
    http.ServerResponse.call(object, request());
    return object;
  },
  "called on an heir": () => {
    const object = new Heir(request());
    http.ServerResponse.call(object, request());
    return object;
  },
  "called without new": () => http.ServerResponse(request()),
};

const attempt = action => {
  try {
    return action();
  } catch (error) {
    return "threw " + error.name;
  }
};
for (let i = 0; i < 70; i++) {
  for (const name in makers) {
    lines.push(
      name +
        " " +
        i +
        " stores: " +
        attempt(() => {
          const message = makers[name]();
          message[kOutHeaders] = newMap();
          return (
            show([
              message.getHeaders(),
              message.getHeaderNames(),
              message.getRawHeaderNames(),
              message.getHeader("x-two"),
            ]) +
            " | " +
            show(message[kOutHeaders])
          );
        }),
    );
    lines.push(
      name +
        " " +
        i +
        " reads: " +
        attempt(() => {
          const message = makers[name]();
          message.setHeader("X-One", "1");
          return (
            show(message[kOutHeaders]) +
            " | " +
            show(message.getHeaders()) +
            " " +
            show({ ...message }[kOutHeaders]) +
            " " +
            show(Object.getOwnPropertyDescriptor(message, kOutHeaders)?.value)
          );
        }),
    );
  }
}
console.log(lines.join("\n"));
