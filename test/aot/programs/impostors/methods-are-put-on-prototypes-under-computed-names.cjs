function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Router(base) {
  this.base = base;
  this.routes = [];
}

["get", "post", "remove"].forEach(function (verb) {
  Router.prototype[verb] = function (path) {
    this.routes.push(verb + " " + this.base + path);
    return this;
  };
});

var extras = {
  list: function () {
    return this.routes.join(", ");
  },
  count: function () {
    return this.routes.length;
  },
};
Object.keys(extras).forEach(function (name) {
  Router.prototype[name] = extras[name];
});

for (var index = 0; index < 2; index++) {
  Router.prototype["step" + index] = (function (step) {
    return function () {
      return "step " + step + " of " + this.base;
    };
  })(index);
}

Router.prototype.del = Router.prototype["delete"] = Router.prototype.remove;
Router.prototype.toJSON = Router.prototype.toString = function () {
  return "router " + this.base;
};

Object.defineProperty(Router.prototype, ["si", "ze"].join(""), {
  get: function () {
    return this.routes.length * 10;
  },
});

function useGet(router) {
  return router.get("/a");
}

function usePost(router) {
  return router.post("/b");
}

function useList(router) {
  return router.list();
}

function useStep(router) {
  return router.step1();
}

function useSize(router) {
  return router.size;
}

var length = 0;
for (var i = 0; i < 2000; i++) {
  var honest = new Router("/r" + (i % 3));
  length += useList(usePost(useGet(honest))).length + useStep(honest).length + useSize(honest);
}
console.log("2000 honest routers", length);

attempt("get, post, list", function () { return useList(usePost(useGet(new Router("/x")))); });
attempt("count", function () { return useGet(new Router("/x")).count(); });
attempt("step0, step1", function () { return [new Router("/x").step0(), useStep(new Router("/x"))]; });
attempt("del, delete and remove are one function", function () { return [Router.prototype.del === Router.prototype.remove, Router.prototype["delete"] === Router.prototype.remove]; });
attempt("del", function () { return useList(new Router("/x").del("/c")); });
attempt("in a template, in JSON", function () { return [`${new Router("/x")}`, JSON.stringify({ router: new Router("/x") })]; });
attempt("size", function () { return useSize(useGet(new Router("/x"))); });
attempt("names on the prototype", function () { return Object.keys(Router.prototype); });
attempt("for-in over a router", function () { var names = []; for (var name in new Router("/x")) names.push(name); return names; });
attempt("a verb that was never defined", function () { return new Router("/x").patch("/d"); });

var impostors = [
  ["a literal with its own get", function () { return { base: "/l", routes: [], get: function () { return "a literal's get"; }, post: function () { return this; }, list: function () { return "a literal's list"; }, step1: function () { return "a literal's step"; }, size: "a literal's size" }; }],
  ["a literal under the prototype", function () { return { __proto__: Router.prototype, routes: ["early"], base: "/p" }; }],
  ["an object made from the prototype alone", function () { return Object.create(Router.prototype); }],
  ["a router whose routes is a string", function () { var router = new Router("/s"); router.routes = "text"; return router; }],
  ["a router whose routes is an array-like", function () { var router = new Router("/s"); router.routes = { length: 0, push: Array.prototype.push, join: Array.prototype.join }; return router; }],
  ["a router with its own get", function () { var router = new Router("/o"); router.get = function () { return "own get"; }; return router; }],
  ["a frozen router", function () { return Object.freeze(new Router("/f")); }],
  ["a Map, which has get and size", function () { return new Map([["/a", "from the map"]]); }],
  ["a URLSearchParams, which has get and size", function () { return new URLSearchParams("/a=found"); }],
];
impostors.forEach(function (pair) {
  [["get", useGet], ["post", usePost], ["list", useList], ["step1", useStep], ["size", useSize]].forEach(function (use) {
    attempt(pair[0] + ": " + use[0], function () {
      var result = use[1](pair[1]());
      return typeof result === "object" && result !== null ? "an object with " + Object.keys(result).join() : result;
    });
  });
  attempt("honest again", function () { return useList(usePost(useGet(new Router("/x")))); });
});

["get", "list"].forEach(function (name) {
  Router.prototype[name] = function () {
    return "replaced " + name;
  };
});
attempt("after a loop replaced get and list", function () { return [useGet(new Router("/x")), useList(new Router("/x"))]; });
delete Router.prototype["po" + "st"];
attempt("after post was deleted under a computed name", function () { return usePost(new Router("/x")); });
