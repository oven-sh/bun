// A function whose result is proven a number or a boolean returns it raw to whoever calls it directly. Here the library and the engine call such functions by value: callbacks of the array methods,
// comparators, call, apply, bind, Reflect.apply, conversions, accessors that are defined late, replacers, timers and promises. Each of them has to get a boxed value.
const report = value =>
  console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));
function told(n) {
  report(n);
  report(n + 1);
  report(n * 2);
  report(n === n);
  report(typeof n);
}
function half(n) {
  return n / 2;
}
function bits(n) {
  return n | 0;
}
function isBig(n) {
  return n > 2;
}
function isWhole(n) {
  return n % 1 === 0;
}
function add(a, b) {
  return a + b;
}
function ascending(a, b) {
  return a - b;
}
function descendingBits(a, b) {
  return (b - a) | 0;
}
function isLess(a, b) {
  return a < b;
}
function byHalves(a, b) {
  return (a - b) / 2;
}
// Each is called directly too, so that a direct caller takes the raw result of the same body.
told(half(5));
told(bits(5.5));
told(isBig(5));
told(isWhole(5.5));
told(add(1, 2.5));
told(ascending(1, 2));
told(descendingBits(1, 2));
told(isLess(1, 2));
told(byHalves(1, 2));

const list = [3, 1.5, 4, 1, 5.25, 9, 2, 6];
report(list.map(half).join());
report(list.map(bits).join());
report(list.map(isBig).join());
report(list.filter(isBig).join());
report(list.filter(isWhole).join());
report(list.filter(bits).join());
report(list.some(isBig));
report(list.every(isBig));
report(list.every(half));
report(list.find(isWhole));
report(list.findIndex(isWhole));
report(list.findLast(isBig));
report(list.findLastIndex(isWhole));
report(list.reduce(add));
report(list.reduce(add, 0.5));
report(list.reduceRight(add, 1));
report(list.flatMap(half).join());
report([...list].sort(ascending).join());
report([...list].sort(descendingBits).join());
report([...list].sort(byHalves).join());
report([...list].sort(isLess).join());
report(list.toSorted(ascending).join());
report(Array.from(list, half).join());
report(Array.from({ length: 3 }, add).join());
report(Array.from(new Set(list), bits).join());
let seen = 0;
list.forEach(function (n) {
  seen += half(n);
  return seen;
});
report(seen);
report(new Float64Array(list).map(half).join());
report(new Int32Array(list).map(bits).join());
report(new Float64Array(list).sort(ascending).join());
report(new Float64Array(list).filter(isBig).join());
report(new Float64Array(list).reduce(add));
report(new Float64Array(list).findIndex(isWhole));

told(half.call(null, 7));
told(half.apply(null, [7]));
told(bits.apply(null, [7.5]));
told(isBig.apply(null, [7]));
told(Reflect.apply(half, null, [9]));
told(Reflect.apply(isBig, null, [1]));
told(half.bind(null)(11));
told(half.bind(null, 13)());
told(add.bind(null, 1)(2.5));
told(isBig.bind(null, 13)());
told(bits.bind(null, 13.5)());
report(typeof new half(1));
report(typeof Reflect.construct(bits, [1]));

const converted = {
  valueOf() {
    return 2.5;
  },
};
const convertedBits = {
  valueOf() {
    return 7 | 0;
  },
};
const convertedFlag = {
  valueOf() {
    return list.length > 2;
  },
};
const hinted = {
  [Symbol.toPrimitive](hint) {
    return hint.length;
  },
};
const named = {
  toString() {
    return 12;
  },
};
told(converted.valueOf());
told(convertedBits.valueOf());
told(convertedFlag.valueOf());
told(converted + 1);
told(converted * 2);
told(convertedBits + 1);
told(convertedBits | 8);
told(convertedFlag + 1);
told(+hinted);
report(`${hinted}`);
report(hinted + "");
report(`${named}`);
report(named + 1);
report(String(converted));
report(Number(convertedFlag));
report([converted, convertedBits].join());
report(list[convertedBits]);
report(Math.max(converted, convertedBits));
report(new Date(converted).getTime());
report("abc".charAt(convertedFlag));
report("abc".repeat(converted));

const holder = { w: 3 };
Object.defineProperty(holder, "twice", {
  get() {
    return this.w * 2;
  },
  enumerable: true,
});
Object.defineProperty(holder, "isThree", {
  get() {
    return this.w === 3;
  },
  enumerable: true,
});
told(holder.twice);
told(holder.isThree);
report(JSON.stringify(holder));
report(Object.entries(holder).join(";"));
report(Object.values(holder).join());
report(JSON.stringify({ ...holder }));
report(Object.assign({}, holder).twice);
const { twice, isThree } = holder;
told(twice);
told(isThree);
report(Reflect.get(holder, "twice"));
report(Object.getOwnPropertyDescriptor(holder, "twice").get.call({ w: 1.5 }));

report(
  JSON.stringify(
    {
      a: {
        toJSON() {
          return 1.5;
        },
      },
      b: {
        toJSON() {
          return list.length > 100;
        },
      },
    },
    function (key, value) {
      return typeof value === "number" ? half(value) : value;
    },
  ),
);
report(JSON.parse("[1,2,3]", (key, value) => (typeof value === "number" ? value * 2 : value)).join());
report("a1b22c333".replace(/\d+/g, digits => digits.length));
report("a1b22c333".replace(/\d+/g, digits => digits.length > 1));
report("abc".replace("b", () => 0.5));
const map = new Map([
  [1, 2],
  [3, 4.5],
]);
let fromMap = 0;
map.forEach((value, key) => (fromMap += add(value, key)));
report(fromMap);
report(
  new Proxy(
    {},
    {
      get(target, key) {
        return key.length;
      },
      has(target, key) {
        return key.length > 2;
      },
    },
  ).four,
);
report(
  "abc" in
    new Proxy(
      {},
      {
        has(target, key) {
          return key.length > 2;
        },
      },
    ),
);
class Even {
  static [Symbol.hasInstance](n) {
    return n % 2 === 0;
  }
}
report(4 instanceof Even);
report(5 instanceof Even);
report(Even[Symbol.hasInstance](6));

Promise.resolve(5)
  .then(half)
  .then(n => {
    told(n);
    return isBig(n);
  })
  .then(flag => {
    told(flag);
    return new Promise(resolve => setTimeout(() => resolve(bits(9.5)), 1));
  })
  .then(told);
queueMicrotask(() => half(3));
