"use strict";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function escape(text) {
  return text.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
}

function compile(path, keys) {
  let source = "";
  let index = 0;
  while (index < path.length) {
    const kind = path[index];
    if (kind === ":" || kind === "*") {
      const name = NAME.exec(path.slice(index + 1));
      if (!name) throw new TypeError("a parameter without a name in " + path);
      keys.push(name[0]);
      source += kind === ":" ? "([^\\/]+)" : "(.+)";
      index += 1 + name[0].length;
      continue;
    }
    source += escape(kind);
    index++;
  }
  return new RegExp("^" + source + "\\/?$", "i");
}

function Layer(method, path, handlers) {
  if (!(this instanceof Layer)) return new Layer(method, path, handlers);
  for (const handler of handlers) if (typeof handler !== "function") throw new TypeError("a handler that is no function");
  this.method = method;
  this.keys = [];
  this.regexp = compile(path, this.keys);
  this.handler = handlers[handlers.length - 1];
}

Layer.prototype.match = function match(method, path) {
  if (this.method !== "ALL" && this.method !== method) return null;
  const found = this.regexp.exec(path);
  if (!found) return null;
  const params = {};
  for (let index = 0; index < this.keys.length; index++) params[this.keys[index]] = found[index + 1];
  return params;
};

class Router {
  #stack = [];
  add(method, path, handlers) {
    this.#stack.push(Layer(method, path, handlers));
  }
  find(method, path) {
    for (const layer of this.#stack) {
      const params = layer.match(method, path);
      if (params) return layer.handler(params);
    }
    return "404";
  }
}

const proto = {
  handle(method, path) {
    return this.router.find(method, path);
  },
};
["get", "post", "all"].forEach(function (method) {
  proto[method] = function (path) {
    this.router.add(method.toUpperCase(), path, Array.prototype.slice.call(arguments, 1));
    return this;
  };
});

module.exports = function framework() {
  let router = null;
  const app = Object.create(proto);
  Object.defineProperty(app, "router", {
    get() {
      return (router ??= new Router());
    },
  });
  return app;
};
