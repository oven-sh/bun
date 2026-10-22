function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

const seen = [];

function totalOne(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfOne(n) {
  return n / 2;
}

const objectOne = {
  get sneak() {
    seen.push(show(totalOne("12")), show(halfOne("4")));
    return 1;
  },
};

function totalTwo(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTwo(n) {
  return n / 2;
}

const objectTwo = {
  get sneak() {
    seen.push(show(totalTwo("12")), show(halfTwo("4")));
    return 1;
  },
};

function totalThree(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfThree(n) {
  return n / 2;
}

const objectThree = {
  get sneak() {
    seen.push(show(totalThree("12")), show(halfThree("4")));
    return 1;
  },
};

function totalFour(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFour(n) {
  return n / 2;
}

const objectFour = {
  get sneak() {
    seen.push(show(totalFour("12")), show(halfFour("4")));
    return 1;
  },
};

function totalFive(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfFive(n) {
  return n / 2;
}

const objectFive = {
  get sneak() {
    seen.push(show(totalFive("12")), show(halfFive("4")));
    return 1;
  },
};

function totalSix(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfSix(n) {
  return n / 2;
}

class ToolSix {
  get sneak() {
    seen.push(show(totalSix("12")), show(halfSix("4")));
    return 1;
  }
}

function totalSeven(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfSeven(n) {
  return n / 2;
}

const objectSeven = {
  set sneak(value) {
    seen.push(show(totalSeven("12")), show(halfSeven("4")));
  },
};

function totalEight(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfEight(n) {
  return n / 2;
}

Object.defineProperty(globalThis, "sneakyGlobalEight", {
  get() {
    seen.push(show(totalEight("12")), show(halfEight("4")));
    return 1;
  },
});

function totalNine(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfNine(n) {
  return n / 2;
}

const proxyNine = new Proxy({}, {
  get() {
    seen.push(show(totalNine("12")), show(halfNine("4")));
    return 1;
  },
});

function totalTen(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTen(n) {
  return n / 2;
}

const proxyTen = new Proxy({}, {
  has() {
    seen.push(show(totalTen("12")), show(halfTen("4")));
    return true;
  },
});

function totalEleven(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfEleven(n) {
  return n / 2;
}

const proxyEleven = new Proxy({}, {
  ownKeys() {
    seen.push(show(totalEleven("12")), show(halfEleven("4")));
    return [];
  },
});

function totalTwelve(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function halfTwelve(n) {
  return n / 2;
}

const proxyTwelve = new Proxy({}, {
  getPrototypeOf() {
    seen.push(show(totalTwelve("12")), show(halfTwelve("4")));
    return null;
  },
});

console.log("strict:", (function () { return this === undefined; })());
attempt("a getter read by a computed name", () => objectOne[["sn", "eak"].join("")]);
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
attempt("a getter read by a spread", () => ({ ...objectTwo }));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
attempt("a getter read by JSON.stringify", () => JSON.stringify(objectThree));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
attempt("a getter read by Object.values", () => Object.values(objectFour));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
attempt("a getter read by destructuring with a rest", () => { const { ...copy } = objectFive; return copy; });
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
attempt("a getter on the prototype of a class", () => Reflect.get(new ToolSix(), ["sn", "eak"].join("")));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
attempt("a setter reached by Object.assign", () => Object.keys(Object.assign(objectSeven, JSON.parse('{"sneak":1}'))));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
attempt("a getter on the global object read as a variable", () => sneakyGlobalEight);
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
attempt("the get trap of a proxy", () => proxyNine.anything);
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
attempt("the has trap of a proxy", () => "anything" in proxyTen);
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
attempt("the ownKeys trap of a proxy", () => Object.keys(proxyEleven));
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalEleven([1, 2, 3]), totalEleven([]), totalEleven(new Array(4, 5)), totalEleven([0.5]), halfEleven(4), halfEleven(3), halfEleven(0.5), halfEleven(-8));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
attempt("the getPrototypeOf trap of a proxy", () => proxyTwelve instanceof Object);
console.log("  what the impostor's caller saw:", seen.splice(0).join(" "));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
