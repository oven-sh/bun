// Calling a Proxy: an own apply trap on a plain handler, and every handler that must take the generic call.
function errorName(run) {
  try {
    return "returned " + String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

function target(...args) {
  return `target(${args.join(", ")})`;
}

const ownTrap = new Proxy(target, {
  apply(callee, thisValue, args) {
    console.log("own trap", callee === target, thisValue === undefined, Array.isArray(args), args.length);
    return "trapped " + Reflect.apply(callee, thisValue, args);
  },
});
console.log(ownTrap(1, 2));
console.log(ownTrap());

const holder = { ownTrap };
const receivers = [];
const receiverTrap = new Proxy(target, {
  apply(callee, thisValue) {
    receivers.push(thisValue);
    return receivers.length;
  },
});
holder.receiverTrap = receiverTrap;
console.log(holder.receiverTrap(), receivers[0] === holder);
console.log(receiverTrap.call(7), receivers[1] === 7);

const { proxy: revoked, revoke } = Proxy.revocable(target, {
  apply() {
    return "never";
  },
});
console.log("before revoke:", revoked());
revoke();
console.log("revoked:", errorName(() => revoked(1)));

const handlerProxy = new Proxy(target, new Proxy({
  apply() {
    return "trap of a proxy handler";
  },
}, {
  get(handler, key) {
    console.log("handler get", String(key));
    return handler[key];
  },
}));
console.log(handlerProxy(1));

const getterTrap = new Proxy(target, {
  get apply() {
    console.log("apply getter");
    return () => "trap from a getter";
  },
});
console.log(getterTrap(1));

console.log("number trap:", errorName(() => new Proxy(target, { apply: 5 })(1)));
console.log("null trap:", new Proxy(target, { apply: null })(1));

const inherited = new Proxy(target, Object.create({
  apply() {
    return "inherited trap";
  },
}));
console.log(inherited(1));

console.log("no trap:", new Proxy(target, {})(1, 2));
console.log("not callable:", errorName(() => new Proxy({}, { apply: () => "never" })()));
console.log("plain call:", target(1, 2));
