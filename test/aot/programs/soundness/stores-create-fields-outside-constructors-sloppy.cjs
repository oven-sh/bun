// A name that is first stored outside the constructor. The store finds no own property, so it asks the prototypes: a setter, a read-only property, a proxy,
// an object that takes no more properties. The function has run many times on fresh objects before. The same text is strict as a module and sloppy as CommonJS.
var lines = [];
function show(label, value) {
  lines.push(label + ": " + JSON.stringify(value));
}

function Request(url) {
  this.url = url;
}
Request.prototype.path = function () {
  return this.url;
};
function route(request, value) {
  request.route = value;
  request.params = { id: value };
  return request;
}
function attempt(f, request, value) {
  try {
    f(request, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function describe(request) {
  return [Object.keys(request), request.route, request.params === undefined ? "none" : request.params.id, Object.prototype.hasOwnProperty.call(request, "route")];
}

var total = 0;
for (var i = 0; i < 20000; i++) {
  total += route(new Request("/a"), i).route + route(new Request("/b"), i).params.id;
}
show("warm", total);

show("fresh", describe(route(new Request("/fresh"), 1)));
var twice = route(route(new Request("/twice"), 1), 2);
show("stored twice", describe(twice));

var other = new Request("/order");
other.params = "first";
show("other order of creation", describe(route(other, 3)));

var deleted = route(new Request("/deleted"), 4);
delete deleted.route;
show("deleted", describe(deleted));
show("created again", describe(route(deleted, 5)));

[Object.preventExtensions, Object.seal, Object.freeze].forEach(function (close) {
  var closed = close(new Request("/closed"));
  show(close.name, [attempt(route, closed, 6), describe(closed)]);
  var filled = close(route(new Request("/filled"), 7));
  show(close.name + ", filled", [attempt(route, filled, 8), describe(filled)]);
});

var seen = [];
var withSetter = Object.create(Request.prototype, {
  route: {
    set: function (value) {
      seen.push(value);
    },
    get: function () {
      return "from the getter";
    },
  },
});
var relinked = new Request("/relinked");
Object.setPrototypeOf(relinked, withSetter);
show("prototype with a setter", [attempt(route, relinked, 9), describe(relinked), seen]);

var readOnly = Object.create(Request.prototype, { route: { value: "fixed", writable: false } });
var below = new Request("/below");
Object.setPrototypeOf(below, readOnly);
show("read-only above", [attempt(route, below, 10), describe(below)]);

var plainAbove = Object.create(Request.prototype);
plainAbove.route = "inherited";
var hides = new Request("/hides");
Object.setPrototypeOf(hides, plainAbove);
show("writable above, before", [hides.route, Object.keys(hides)]);
show("writable above", [attempt(route, hides, 11), describe(hides), plainAbove.route]);

var trapped = [];
var proxy = new Proxy(Request.prototype, {
  set: function (target, key, value, receiver) {
    trapped.push(String(key));
    return Reflect.set(target, key, value, receiver);
  },
});
var underProxy = new Request("/proxy");
Object.setPrototypeOf(underProxy, proxy);
show("proxy above", [attempt(route, underProxy, 12), describe(underProxy), trapped]);

var bare = new Request("/bare");
Object.setPrototypeOf(bare, null);
show("no prototype", [attempt(route, bare, 13), Object.keys(bare), bare.route]);

// From here on every Request inherits a setter.
var late = [];
Object.defineProperty(Request.prototype, "route", {
  set: function (value) {
    late.push(value);
  },
  configurable: true,
});
show("setter defined late", [attempt(route, new Request("/late"), 14), describe(route(new Request("/late"), 15)), late]);
show("own property stays", [attempt(route, twice, 16), describe(twice), late]);
delete Request.prototype.route;
show("setter removed", describe(route(new Request("/again"), 17)));

console.log(lines.join("\n"));
