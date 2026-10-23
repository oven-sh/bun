// A callee that is handed a closure reads its length and name, takes call, apply and bind off it, lists its keys. One closure of a function among many has an accessor of its own under such a name, another prototype, or is a class object with static accessors, a bound function, the closure of a coroutine.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => typeof k + " " + k()).join("+") || "nobody";
const arity = callback => callback.length;
const label = callback => callback.name;
const viaCall = callback => callback.call(null);
const viaApply = callback => callback.apply(null, []);
const viaBind = callback => callback.bind(null)();
const listed = callback => Object.keys(callback).join() + "|" + JSON.stringify(Object.entries(callback));
const inLoop = callback => {
  let text = "";
  for (const key in callback) text += key + "=" + callback[key] + ";";
  return text;
};
const readers = { arity, label, viaCall, viaApply, viaBind, listed, inLoop };
function make(i, change) {
  const captured = "closure" + i;
  const closure = () => captured;
  change?.(closure);
  return closure;
}
function spyUnder(name, answer) {
  return closure =>
    Object.defineProperty(closure, name, {
      get() {
        kept.push(this);
        return answer(this);
      },
      enumerable: true,
      configurable: true,
    });
}
const above = Object.create(Function.prototype, {
  call: {
    get() {
      kept.push(this);
      return Function.prototype.call;
    },
  },
  extra: {
    get() {
      kept.push(this);
      return "inherited";
    },
    enumerable: true,
  },
});
const changes = {
  none: undefined,
  length: spyUnder("length", () => 42),
  name: spyUnder("name", () => "spied"),
  call: spyUnder("call", () => Function.prototype.call),
  apply: spyUnder("apply", () => Function.prototype.apply),
  bind: spyUnder("bind", () => Function.prototype.bind),
  other: spyUnder("other", () => "own"),
  data: closure => {
    closure.other = "data";
  },
  above: closure => Object.setPrototypeOf(closure, above),
};
const lines = [];
let i = 0;
for (const [reader, read] of Object.entries(readers)) {
  for (const [change, apply] of Object.entries(changes)) {
    lines.push(reader + " " + change + " " + read(make(i++, apply)));
    churn(20);
    lines.push(report());
  }
}
// Other kinds of functions at the same calls.
const keptClasses = [];
class WithStatics {
  static get length() {
    keptClasses.push(this);
    return 9;
  }
  static get name() {
    keptClasses.push(this);
    return "static";
  }
  static get other() {
    keptClasses.push(this);
    return "static other";
  }
}
lines.push(arity(WithStatics), label(WithStatics), listed(WithStatics), keptClasses.length);
lines.push(arity(make(i++).bind(null, 1)), label(make(i++).bind(null)), viaCall(make(i++).bind(null)));
lines.push(arity(async (a, b) => a), label(function* named() {}), listed(async function () {}));
console.log(lines.join("\n"));
