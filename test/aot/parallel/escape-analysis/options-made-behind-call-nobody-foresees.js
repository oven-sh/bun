// An options object is made for a function that only takes it apart, behind the call of a method that was stored under a computed key: the compiler expects no function there, so it expects nothing behind that call to run.
const methods = ["get", "post"];
const app = { settings: { env: "test", etag: "weak" } };
methods.forEach(function (method) {
  app[method] = function (path) {
    if (method === "get" && arguments.length === 1) return this.settings[path];
    return method + " " + path + " " + (arguments.length - 1);
  };
});

function finalhandler(req, options) {
  var opts = options || {};
  var env = opts.env || "development";
  var onerror = opts.onerror;
  return function (err) {
    return req + ":" + env + ":" + (onerror ? onerror(err) : "none");
  };
}

function logerror(err) {
  return "logged " + err + " by " + this.settings.env;
}

app.handle = function handle(req, callback) {
  var done = callback || finalhandler(req, { env: this.get("env"), onerror: logerror.bind(this) });
  return done("e" + req);
};

function area(options) {
  return options.width * options.height + (options.depth === undefined ? 0 : options.depth);
}
app.measure = function measure(n) {
  const unit = this.get("unit");
  return area({ width: n, height: unit === undefined ? 2 : unit });
};
app.measureDeep = function measureDeep(n) {
  const etag = this.get("etag");
  return area({ width: n, height: etag.length, depth: n * 10 });
};

function describe(options) {
  return options.name + "/" + options.list.length + "/" + options.inner.x;
}
app.describe = function (n) {
  return describe({ name: this.post("/a", n), list: [n, n + 1], inner: { x: this.get("env") } });
};

function failing() {
  throw new RangeError("no value");
}
app.fails = function (n) {
  try {
    return area({ width: this.get("env").length, height: n > 1 ? failing() : n });
  } catch (error) {
    return String(error);
  }
};

for (let i = 0; i < 3; i++) console.log(app.handle(i));
console.log(app.handle(9, e => "own " + e));
let sum = 0;
for (let i = 0; i < 1000; i++) sum += app.measure(i) + app.measureDeep(i & 7);
console.log(sum);
console.log(app.describe(4), app.fails(1), app.fails(2));
app.get = function () {
  return "replaced";
};
console.log(app.handle(5), app.measure(3), app.describe(1));
delete app.get;
try {
  app.handle(6);
} catch (error) {
  console.log(error instanceof TypeError);
}
