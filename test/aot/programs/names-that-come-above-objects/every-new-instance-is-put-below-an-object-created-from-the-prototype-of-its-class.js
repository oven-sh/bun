// Each turn makes an instance of a class and puts it below an object that was created from the class's prototype object, as a framework does with the requests of a server. Then the object above, the one above that and the instance itself are changed in every way, and the same readers are asked again.
class Message {
  constructor(url) {
    this.url = url;
    this.method = "GET";
    this.count = 1;
  }
  describe() {
    return this.method + " " + this.url;
  }
  get size() {
    return this.url.length;
  }
  twice() {
    return this.count * 2;
  }
}

const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
};

function makeAbove() {
  const shared = Object.create(Message.prototype);
  shared.get = function (name) {
    return name + "=" + this.url;
  };
  shared.twice = function () {
    return this.count * 20;
  };
  Object.defineProperty(shared, "fresh", {
    configurable: true,
    enumerable: true,
    get() {
      return this.count === 1;
    },
  });
  const ofTheApplication = Object.create(shared, {
    application: { configurable: true, enumerable: true, writable: true, value: "app" },
  });
  return { shared, ofTheApplication };
}

function read(message) {
  return [
    message.url,
    message.method,
    message.count,
    attempt(() => message.describe()),
    attempt(() => message.size),
    attempt(() => message.twice()),
    attempt(() => message.get("url")),
    attempt(() => message.fresh),
    message.application,
    message.missing,
    "get" in message,
    "missing" in message,
    message instanceof Message,
    Object.keys(message).join(),
  ].join("|");
}

function store(message, value) {
  message.count = value;
  message.next = value + 1;
  message.params = "p" + value;
  message.route = value + 2;
  return [message.count, message.next, message.params, message.route, Object.keys(message).join()].join("|");
}

function inherited(message) {
  const names = [];
  for (const name in message) names.push(name);
  return names.join();
}

function turns(title, prepare, count = 40) {
  let first = "",
    last = "",
    changes = 0;
  for (let i = 0; i < count; i++) {
    const message = new Message("/" + (i & 3));
    const answer = attempt(() => prepare(message, i));
    const text = [answer, read(message), attempt(() => store(message, i & 1)), read(message), inherited(message)].join(" ; ");
    if (i === 0) first = text;
    if (text !== last) changes++;
    last = text;
  }
  say(title, changes, first);
  say(title, "last", last);
}

{
  const { ofTheApplication } = makeAbove();
  turns("never", () => "as born");
  turns("each turn", message => Object.setPrototypeOf(message, ofTheApplication) === message);
  turns("every other turn", (message, i) => (i & 1 ? Object.setPrototypeOf(message, ofTheApplication) === message : "as born"));
  turns("by Reflect", message => Reflect.setPrototypeOf(message, ofTheApplication));
  turns("by the accessor", message => {
    message.__proto__ = ofTheApplication;
    return Object.getPrototypeOf(message) === ofTheApplication;
  });
}

{
  const one = makeAbove(),
    other = makeAbove();
  other.shared.get = function (name) {
    return "other " + name;
  };
  turns("twice", message => {
    Object.setPrototypeOf(message, one.ofTheApplication);
    const before = message.get("a");
    Object.setPrototypeOf(message, other.ofTheApplication);
    return before + "," + message.get("a");
  });
  turns("and back", message => {
    Object.setPrototypeOf(message, one.ofTheApplication);
    const before = message.twice();
    Object.setPrototypeOf(message, Message.prototype);
    return before + "," + message.twice() + "," + attempt(() => message.get("a"));
  });
  turns("one of two", (message, i) => Object.setPrototypeOf(message, i % 3 ? one.ofTheApplication : other.ofTheApplication).get("b"));
}

turns("to null", message => {
  Object.setPrototypeOf(message, null);
  return Object.getPrototypeOf(message);
});

turns("to a plain literal", message => Object.setPrototypeOf(message, { get: () => "literal", count: 9 }).get());

{
  const seen = [];
  const { ofTheApplication } = makeAbove();
  const proxy = new Proxy(ofTheApplication, {
    get(target, name, receiver) {
      if (typeof name === "string" && seen.length < 12) seen.push("get " + name);
      return Reflect.get(target, name, receiver);
    },
    set(target, name, value, receiver) {
      if (seen.length < 12) seen.push("set " + String(name));
      return Reflect.set(target, name, value, receiver);
    },
    has(target, name) {
      if (seen.length < 12) seen.push("has " + String(name));
      return Reflect.has(target, name);
    },
  });
  turns("to a proxy", message => Object.setPrototypeOf(message, proxy) === message);
  say("the proxy saw", seen.join());
}

{
  const { shared, ofTheApplication } = makeAbove();
  const put = message => Object.setPrototypeOf(message, ofTheApplication) === message;
  turns("before any change", put);
  shared.get = function (name) {
    return "replaced " + name;
  };
  turns("a method above is replaced", put);
  ofTheApplication.get = function (name) {
    return "nearer " + name;
  };
  turns("a nearer object gets the name", put);
  delete ofTheApplication.get;
  delete shared.get;
  turns("the name is deleted", put);
  Object.defineProperty(shared, "fresh", { configurable: true, value: "a value now" });
  turns("an accessor becomes a value", put);
  Object.defineProperty(shared, "missing", { configurable: true, get: () => "no longer missing" });
  turns("an absent name comes", put);
  shared.describe = function () {
    return "hides the class's";
  };
  Object.defineProperty(ofTheApplication, "size", { configurable: true, get: () => -1 });
  turns("members of the class are hidden", put);
  Object.setPrototypeOf(shared, {
    describe() {
      return "unreached";
    },
    late() {
      return "late";
    },
  });
  turns("the object above gets another prototype", message => put(message) + "," + message.late() + "," + (message instanceof Message));
}

{
  const { shared, ofTheApplication } = makeAbove();
  const put = message => Object.setPrototypeOf(message, ofTheApplication) === message;
  const caught = [];
  Object.defineProperty(shared, "next", {
    configurable: true,
    set(value) {
      if (caught.length < 4) caught.push("next " + value + " " + (this instanceof Message));
    },
    get() {
      return "from the accessor";
    },
  });
  turns("a setter above a name that is stored later", put);
  say("the setter saw", caught.join());
  Object.defineProperty(shared, "params", { configurable: true, writable: false, value: "read-only above" });
  turns("a read-only property above a name that is stored later", put);
  turns("the same in strict code", message => {
    "use strict";
    put(message);
    return attempt(() => {
      message.params = 1;
      return "stored";
    });
  });
  Object.defineProperty(shared, "count", { configurable: true, set() {}, get: () => "never read" });
  turns("an accessor above a field", put);
  delete shared.next;
  delete shared.params;
  turns("they are taken away again", put);
}

{
  const { ofTheApplication } = makeAbove();
  turns("frozen first", message => attempt(() => Object.setPrototypeOf(Object.freeze(message), ofTheApplication)));
  turns("sealed first", message => attempt(() => Object.setPrototypeOf(Object.seal(message), ofTheApplication)));
  turns("not extensible first", message => Reflect.setPrototypeOf(Object.preventExtensions(message), ofTheApplication));
  turns("not extensible, to the prototype it has", message => Reflect.setPrototypeOf(Object.preventExtensions(message), Message.prototype));
  turns("frozen afterwards", message => Object.isFrozen(Object.freeze(Object.setPrototypeOf(message, ofTheApplication))));
  turns("below itself", message => attempt(() => Object.setPrototypeOf(message, message)));
  turns("in a ring", message => {
    const between = Object.create(message);
    return attempt(() => Object.setPrototypeOf(message, between));
  });
  turns("to what is no object", message => [1, "a", undefined, true, Symbol.iterator].map(value => attempt(() => Object.setPrototypeOf(message, value) === message)).join());
}

{
  const { shared, ofTheApplication } = makeAbove();
  turns("names of its own hide what is above", message => {
    Object.setPrototypeOf(message, ofTheApplication);
    message.get = () => "own";
    message.application = "own application";
    Object.defineProperty(message, "fresh", { configurable: true, value: "own fresh" });
    return Object.keys(message).join();
  });
  turns("and are deleted again", message => {
    Object.setPrototypeOf(message, ofTheApplication);
    message.get = () => "own";
    const before = message.get();
    delete message.get;
    delete message.url;
    return before + "," + message.get("a");
  });
  Object.defineProperty(shared, "swaps", {
    configurable: true,
    get() {
      Object.setPrototypeOf(this, Message.prototype);
      return "swapped while it was read";
    },
  });
  turns("an accessor above takes the object away from below it", message => {
    Object.setPrototypeOf(message, ofTheApplication);
    return [message.swaps, message.swaps, attempt(() => message.get("a")), message.twice()].join();
  });
}

{
  class Longer extends Message {
    constructor(url) {
      super(url);
      this.extra = "e";
    }
    describe() {
      return "longer " + super.describe();
    }
  }
  const { ofTheApplication } = makeAbove();
  let text = "";
  for (let i = 0; i < 40; i++) {
    const longer = new Longer("/l");
    Object.setPrototypeOf(longer, ofTheApplication);
    text = [read(longer), longer instanceof Longer, longer.extra, Longer.prototype.describe.call(longer)].join(" ; ");
  }
  say("an heir loses its own class", text);
}

{
  const { ofTheApplication } = makeAbove();
  const held = [];
  for (let i = 0; i < 64; i++) {
    const message = new Message("/" + i);
    if (i & 1) Object.setPrototypeOf(message, ofTheApplication);
    if (i & 2) message.next = i;
    held.push(message);
  }
  let sum = 0,
    found = 0;
  for (const message of held) {
    sum += message.twice() + message.size + (message.next ?? 0);
    if (message.get) found++;
  }
  say("both kinds in one list", sum, found, JSON.stringify(held[3]), JSON.stringify(held[0]));
}

console.log(lines.join("\n"));
