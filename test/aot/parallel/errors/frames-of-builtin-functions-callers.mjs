// Each function calls a built-in function that throws, or that runs a function of the program while it converts an operand. Every row prints the names that the stack trace lists: the built-in function's own stands above its caller's.
const namesIn = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line => /at (async )?(new )?(\S+)/.exec(line)?.[3])
    .filter(name => name && !name.includes("/") && !name.includes(":"))
    .join(" < ");
function row(label, run) {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", error.constructor.name, "|", namesIn(error.stack));
  }
}
let seen = "";
const text = {
  toString() {
    seen = namesIn(new Error("x").stack);
    return "a";
  },
};
const number = {
  valueOf() {
    seen = namesIn(new Error("x").stack);
    return 1;
  },
};
const look = (...a) => {
  seen = namesIn(new Error("x").stack);
  return 0;
};
const frozen = Object.freeze([1, 2]);
const u8 = new Uint8Array(4);
const cases = {
  frozenPush: function kept() {
    const r = frozen.push(1);
    return r + 1;
  },
  frozenUnshift: function kept() {
    const r = frozen.unshift(1);
    return r + 1;
  },
  frozenPop: function kept() {
    const r = frozen.pop();
    return r + 1;
  },
  frozenShift: function kept() {
    const r = frozen.shift();
    return r + 1;
  },
  frozenSplice: function kept() {
    const r = frozen.splice(0, 1);
    return r + 1;
  },
  frozenFill: function kept() {
    const r = frozen.fill(0);
    return r + 1;
  },
  frozenReverse: function kept() {
    const r = frozen.reverse();
    return r + 1;
  },
  frozenSort: function kept() {
    const r = frozen.sort();
    return r + 1;
  },
  joinText: function kept() {
    const r = [1, 2].join(text);
    return seen + r.length;
  },
  padStart: function kept() {
    const r = "a".padStart(3, text);
    return seen + r.length;
  },
  indexOf: function kept() {
    const r = "abc".indexOf(text);
    return seen + r;
  },
  includes: function kept() {
    const r = "abc".includes(text);
    return seen + r;
  },
  startsWith: function kept() {
    const r = "abc".startsWith(text);
    return seen + r;
  },
  startsWithRegExp: function kept() {
    const r = "abc".startsWith(/a/);
    return seen + r;
  },
  slice: function kept() {
    const r = "abc".slice(number);
    return seen + r;
  },
  substring: function kept() {
    const r = "abc".substring(number);
    return seen + r;
  },
  charCodeAt: function kept() {
    const r = "abc".charCodeAt(number);
    return seen + r;
  },
  charAt: function kept() {
    const r = "abc".charAt(number);
    return seen + r;
  },
  at: function kept() {
    const r = "abc".at(number);
    return seen + r;
  },
  arrayAt: function kept() {
    const r = [1, 2].at(number);
    return seen + r;
  },
  arraySlice: function kept() {
    const r = [1, 2].slice(number);
    return seen + r;
  },
  arrayIndexOf: function kept() {
    const r = [1, 2].indexOf(1, number);
    return seen + r;
  },
  floor: function kept() {
    const r = Math.floor(number);
    return seen + r;
  },
  pow: function kept() {
    const r = Math.pow(number, 2);
    return seen + r;
  },
  min: function kept() {
    const r = Math.min(1, number);
    return seen + r;
  },
  sqrt: function kept() {
    const r = Math.sqrt(number);
    return seen + r;
  },
  parseInt: function kept() {
    const r = parseInt(text);
    return seen + r;
  },
  parseFloat: function kept() {
    const r = parseFloat(text);
    return seen + r;
  },
  string: function kept() {
    const r = String(text);
    return seen + r;
  },
  number: function kept() {
    const r = Number(number);
    return seen + r;
  },
  isNaN: function kept() {
    const r = isNaN(number);
    return seen + r;
  },
  isFinite: function kept() {
    const r = isFinite(number);
    return seen + r;
  },
  assign: function kept() {
    const r = Object.assign(
      {},
      {
        get a() {
          return look();
        },
      },
    );
    return seen + r.a;
  },
  entriesNull: function kept() {
    const r = Object.entries(null);
    return r + 1;
  },
  valuesNull: function kept() {
    const r = Object.values(null);
    return r + 1;
  },
  protoNull: function kept() {
    const r = Object.getPrototypeOf(null);
    return r + 1;
  },
  namesNull: function kept() {
    const r = Object.getOwnPropertyNames(null);
    return r + 1;
  },
  hasOwnNull: function kept() {
    const r = Object.hasOwn(null, "a");
    return r + 1;
  },
  hasOwnKey: function kept() {
    const r = Object.hasOwn({}, text);
    return seen + r;
  },
  hasOwnProperty: function kept() {
    const r = {}.hasOwnProperty(text);
    return seen + r;
  },
  ownKeys: function kept() {
    const r = Reflect.ownKeys(1);
    return r + 1;
  },
  reflectGet: function kept() {
    const r = Reflect.get(1, "a");
    return r + 1;
  },
  defineProperty: function kept() {
    const r = Object.defineProperty(1, "a", {});
    return r + 1;
  },
  create: function kept() {
    const r = Object.create(1);
    return r + 1;
  },
  newArray: function kept() {
    const r = new Array(-1);
    return r + 1;
  },
  callArray: function kept() {
    const r = Array(-1);
    return r + 1;
  },
  arrayFrom: function kept() {
    const r = Array.from({ length: number });
    return seen + r.length;
  },
  newMap: function kept() {
    const r = new Map([1]);
    return r + 1;
  },
  newSet: function kept() {
    const r = new Set(1);
    return r + 1;
  },
  mapGet: function kept() {
    const r = Map.prototype.get.call(1, 1);
    return r + 1;
  },
  stringify: function kept() {
    const r = JSON.stringify({
      toJSON() {
        return look();
      },
    });
    return seen + r;
  },
  sort: function kept() {
    const r = [3, 1].sort(look);
    return seen + r;
  },
  map: function kept() {
    const r = [1].map(look);
    return seen + r;
  },
  forEach: function kept() {
    const r = [1].forEach(look);
    return seen + r;
  },
  filter: function kept() {
    const r = [1].filter(look);
    return seen + r;
  },
  reduce: function kept() {
    const r = [].reduce(look);
    return seen + r;
  },
  find: function kept() {
    const r = [1].find(look);
    return seen + r;
  },
  replace: function kept() {
    const r = "a".replace("a", look);
    return seen + r;
  },
  replaceAll: function kept() {
    const r = "a".replaceAll(/a/, "b");
    return seen + r;
  },
  split: function kept() {
    const r = "a".split(text);
    return seen + r;
  },
  localeCompare: function kept() {
    const r = "a".localeCompare(Symbol());
    return r + 1;
  },
  normalize: function kept() {
    const r = "a".normalize("x");
    return r + 1;
  },
  toStringRadix: function kept() {
    const r = (1).toString(1);
    return r + 1;
  },
  toPrecision: function kept() {
    const r = (1).toPrecision(1000);
    return r + 1;
  },
  newUint8Array: function kept() {
    const r = new Uint8Array(-1);
    return r + 1;
  },
  typedSet: function kept() {
    const r = u8.set([1], 9);
    return r + 1;
  },
  typedFill: function kept() {
    const r = u8.fill(number);
    return seen + r;
  },
  typedSubarray: function kept() {
    const r = u8.subarray(number);
    return seen + r;
  },
  asIntN: function kept() {
    const r = BigInt.asIntN(number, 1n);
    return seen + r;
  },
  toFixedCall: function kept() {
    const r = Number.prototype.toFixed.call("a");
    return r + 1;
  },
  getTimeCall: function kept() {
    const r = Date.prototype.getTime.call(1);
    return r + 1;
  },
  newDate: function kept() {
    const r = new Date(number);
    return seen + r.getTime();
  },
  dateUTC: function kept() {
    const r = Date.UTC(number);
    return seen + r;
  },
  symbolCall: function kept() {
    const r = Symbol(text);
    return seen + String(r);
  },
  newSymbol: function kept() {
    const r = new Symbol();
    return r;
  },
  fromCharCode: function kept() {
    const r = String.fromCharCode(number);
    return seen + r.length;
  },
  fromCodePoint: function kept() {
    const r = String.fromCodePoint(-1);
    return r;
  },
  raw: function kept() {
    const r = String.raw(null);
    return r;
  },
  trimCall: function kept() {
    const r = String.prototype.trim.call(null);
    return r;
  },
  concatCall: function kept() {
    const r = String.prototype.concat.call(null, "a");
    return r;
  },
  regExpTest: function kept() {
    const r = /a/.test(text);
    return seen + r;
  },
  regExpExec: function kept() {
    const r = /a/.exec(text);
    return seen + r;
  },
  newRegExp: function kept() {
    const r = new RegExp("(");
    return r;
  },
  match: function kept() {
    const r = "a".match(text);
    return seen + r;
  },
  promiseResolve: function kept() {
    const r = Promise.resolve.call(1);
    return r;
  },
  newPromise: function kept() {
    const r = new Promise(1);
    return r;
  },
  promiseExecutor: function kept() {
    const r = new Promise(look);
    return seen + typeof r;
  },
  functionApply: function kept() {
    const r = look.apply(null, 1);
    return r;
  },
  functionCall: function kept() {
    const r = look.call(null, 1);
    return seen + r;
  },
  functionBind: function kept() {
    const r = Function.prototype.bind.call(1);
    return r;
  },
  boundCall: function kept() {
    const r = look.bind(null)();
    return seen + r;
  },
  encodeURI: function kept() {
    const r = encodeURIComponent("\ud800");
    return r;
  },
  weakMapSet: function kept() {
    const r = new WeakMap().set(1, 1);
    return r;
  },
  setAdd: function kept() {
    const r = Set.prototype.add.call(1, 1);
    return r;
  },
  isArrayProxy: function kept() {
    const p = Proxy.revocable([], {});
    p.revoke();
    const r = Array.isArray(p.proxy);
    return r;
  },
  arrayConcat: function kept() {
    const r = [].concat({
      get [Symbol.isConcatSpreadable]() {
        return look();
      },
    });
    return seen + r.length;
  },
  arrayIncludes: function kept() {
    const r = [1].includes(1, number);
    return seen + r;
  },
  arrayOf: function kept() {
    const r = Array.of.call(look, 1);
    return seen + typeof r;
  },
  textEncoder: function kept() {
    const r = new TextEncoder().encode(text);
    return seen + r.length;
  },
  bufferFrom: function kept() {
    const r = Buffer.from(1);
    return r;
  },
  bufferAlloc: function kept() {
    const r = Buffer.alloc(-1);
    return r;
  },
};
for (const [label, run] of Object.entries(cases)) {
  seen = "";
  row(label, run);
}
