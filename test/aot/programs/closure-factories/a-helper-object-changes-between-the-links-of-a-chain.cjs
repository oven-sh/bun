// The methods, the fields and the prototype of a helper object change between the links of a chain.
function Forwarder(target, source) {
  if (!(this instanceof Forwarder)) return new Forwarder(target, source);
  this.target = target;
  this.source = source;
  this.names = [];
}
Forwarder.prototype.method = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target[name] = function () {
    return this[source][name].apply(this[source], arguments);
  };
  return this;
};
Forwarder.prototype.access = function (name) {
  return this.getter(name).setter(name);
};
Forwarder.prototype.getter = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target.__defineGetter__(name, function () {
    return this[source][name];
  });
  return this;
};
Forwarder.prototype.setter = function (name) {
  var target = this.target;
  var source = this.source;
  this.names.push(name);
  target.__defineSetter__(name, function (value) {
    return (this[source][name] = value);
  });
  return this;
};
const log = [];
const show = object => Object.getOwnPropertyNames(object).join();

// A method is replaced in front of the chain and in the middle of it.
const first = {};
const getter = Forwarder.prototype.getter;
const method = Forwarder.prototype.method;
Forwarder.prototype.getter = function (name) {
  log.push("replaced " + name);
  return this;
};
Forwarder(first, "inner").getter("a").method("b");
Forwarder.prototype.getter = getter;
console.log(show(first), log.join());

const second = { inner: { a: 1, b: 2, c: 3 }, other: { a: 10, b: 20, c: 30 } };
second.__defineSetter__("swap", function () {});
Forwarder.prototype.method = (function (method) {
  return function (name) {
    Forwarder.prototype.getter = function (name) {
      log.push("late " + name);
      return getter.call(this, name + name);
    };
    return method.call(this, name);
  };
})(Forwarder.prototype.method);
Forwarder(second, "inner").getter("a").method("m").getter("b");
Forwarder.prototype.getter = getter;
Forwarder.prototype.method = method;
console.log(show(second), second.a, second.b, second.bb, log.join());

// The fields of the helper object are stored again between two links.
const third = { inner: { a: 1, b: 2 }, other: { a: 10, b: 20 } };
const elsewhere = { inner: { c: 3 } };
const helper = Forwarder(third, "inner");
helper.getter("a");
helper.source = "other";
helper.getter("b");
helper.target = elsewhere;
helper.source = "inner";
helper.getter("c");
console.log(show(third), show(elsewhere), third.a, third.b, elsewhere.c, helper.names.join());

// An own member hides the method, and another prototype answers.
const fourth = { inner: { a: 1 } };
const hidden = Forwarder(fourth, "inner");
hidden.getter = function (name) {
  log.push("own " + name);
  return this;
};
hidden.getter("a");
delete hidden.getter;
Object.setPrototypeOf(hidden, {
  getter(name) {
    log.push("other prototype " + name);
    return this;
  },
});
hidden.getter("a");
console.log(show(fourth), log.slice(-2).join());

// The fields are accessors that count their reads, and the receiver is no helper object at all.
const fifth = { inner: { a: 1 } };
let reads = 0;
const counted = {
  get target() {
    reads++;
    return fifth;
  },
  get source() {
    reads++;
    return "inner";
  },
  names: [],
  getter,
};
counted.getter("a");
console.log(show(fifth), fifth.a, reads);
try {
  getter.call(undefined, "a");
} catch (error) {
  console.log(error.constructor.name);
}

// The target is frozen, is a proxy, and has its own way to define a getter.
const frozen = Object.freeze({ inner: {} });
try {
  Forwarder(frozen, "inner").method("a").getter("b");
} catch (error) {
  console.log(error.constructor.name, show(frozen));
}
const seen = [];
const proxy = new Proxy({ inner: { a: 5 } }, {
  defineProperty(target, name, descriptor) {
    seen.push("define " + String(name));
    return Reflect.defineProperty(target, name, descriptor);
  },
});
Forwarder(proxy, "inner").getter("a").method("b");
console.log(seen.join(), proxy.a);
const own = {
  __defineGetter__(name) {
    seen.push("own " + name);
  },
};
Forwarder(own, "inner").getter("a");
console.log(seen.at(-1), show(own));

// What was defined is redefined and deleted.
const sixth = { inner: { a: 1 }, other: { a: 2 } };
Forwarder(sixth, "inner").getter("a");
const child = Object.create(sixth);
console.log(child.a);
Forwarder(sixth, "other").getter("a");
console.log(child.a);
delete sixth.a;
console.log(child.a);
