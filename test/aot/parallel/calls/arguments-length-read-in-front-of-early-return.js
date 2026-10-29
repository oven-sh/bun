// Functions that ask for arguments.length and can return before they need their arguments object, as the verbs of an Express application do: `app.get(setting)`.
// They are called through values that nobody knows. The list of the arguments that no parameter takes is made on the way that goes on, and on no other.
// COUNT: cells <= 1000
"use strict";
const slice = Array.prototype.slice;
function createApp(name) {
  const app = function (request) {
    return app.handle(request);
  };
  app.appName = name;
  app.settings = { env: "test", etag: "weak", "trust proxy": false };
  app.routes = [];
  Object.assign(app, proto);
  return app;
}
const proto = {};
proto.set = function set(setting, value) {
  if (arguments.length === 1) return this.settings[setting];
  this.settings[setting] = value;
  return this;
};
proto.handle = function handle(request) {
  request.app = this;
  return respond(request);
};
proto.count = function count(first) {
  if (arguments.length < 2) return arguments.length;
  const before = arguments.length;
  arguments.length = 1;
  return before + ":" + arguments.length + ":" + slice.call(arguments).join();
};
proto.sloppyLike = function (a, b) {
  if (arguments.length === 0) return "none";
  if (arguments.length === 1) return "one " + a;
  a = "changed";
  return arguments.length + " " + arguments[0] + " " + b + " " + slice.call(arguments, 2).join("|");
};
proto.throws = function (path) {
  if (arguments.length === 1) return this.missing.get(path);
  return slice.call(arguments, 1);
};
proto.tries = function (flag) {
  if (flag === 0) return "none";
  try {
    flag.missing.deeper;
  } catch (error) {}
  try {
    return arguments[1] + ":" + arguments.length;
  } catch (error) {
    return "caught";
  }
};
["get", "post", "put"].forEach(function (method) {
  proto[method] = function (path) {
    if (method === "get" && arguments.length === 1) return this.set(path);
    this.routes.push(method + " " + path + " " + slice.call(arguments, 1).length);
    return this;
  };
});
function respond(request) {
  const app = request.app;
  const etag = app.get("etag");
  const env = app.get("env");
  const proxy = app.get("trust proxy");
  return etag + env + proxy + app.count(request.n) + app.sloppyLike(request.n) + app.tries(request.n & 1, request.n);
}
// Text that is made when the program runs: nobody knows what comes back.
const handedBack = (0, eval)("value => " + String.fromCharCode(118, 97, 108, 117, 101));
const apps = [handedBack(createApp("one")), handedBack(createApp("two"))];
apps[0]
  .get(
    "/a",
    () => 1,
    () => 2,
  )
  .post("/b", () => 3)
  .put("/c");
let total = 0;
for (let i = 0; i < 30000; i++) total += apps[i & 1]({ n: i & 3 }).length;
let message = "";
try {
  apps[0].throws("x");
} catch (error) {
  message =
    error.constructor.name +
    " " +
    error.stack
      .split("\n")
      .slice(1, 3)
      .map(line => line.trim().split(" ")[1])
      .join(",");
}
console.log(
  total,
  apps[0].routes.join(";"),
  apps[1].routes.length,
  apps[0].count(),
  apps[0].count(1, 2, 3),
  apps[0].sloppyLike(),
  apps[0].sloppyLike(1, 2, 3, 4),
  apps[0].throws("x", "y").join(),
  apps[0].tries(0),
  apps[0].tries(1),
  apps[0].tries(2, "two", 3),
  message,
);
