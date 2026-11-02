// The function that `format` of a number or date formatter returns, called with every kind of receiver and argument list.
const numbers = new Intl.NumberFormat("de");
const dates = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
const log = [];
const attempt = (name, run) => {
  try {
    log.push(name + ": " + run());
  } catch (error) {
    log.push(name + ": threw " + error.name);
  }
};
const seen = [];
const counted = {
  valueOf() {
    seen.push("valueOf");
    return 1234.5;
  },
};
const throwing = {
  valueOf() {
    throw new RangeError("no");
  },
};
for (let round = 0; round < 3; round++) {
  const free = numbers.format;
  attempt("as a method", () => numbers.format(1234.5));
  attempt("free", () => free(1234.5));
  attempt("no argument", () => numbers.format());
  attempt("three arguments", () => numbers.format(1, 2, 3));
  attempt("spread", () => numbers.format(...[7, 8]));
  attempt("call with null", () => numbers.format.call(null, 2.5));
  attempt("apply", () => Reflect.apply(numbers.format, {}, [5]));
  attempt("map", () => [1000, 2000.5].map(numbers.format).join(" "));
  attempt("a string", () => numbers.format("12345.678"));
  attempt("a BigInt", () => numbers.format(12345678901234567890n));
  attempt("an object", () => numbers.format(counted) + " " + seen.length);
  attempt("an object that throws", () => numbers.format(throwing));
  attempt("a symbol", () => numbers.format(Symbol("s")));
  attempt("the same function", () => numbers.format === free);
  attempt("name and length", () => JSON.stringify([free.name, free.length]));
  attempt("the getter", () =>
    Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format").get.call(numbers)(3),
  );
  attempt("the getter on another receiver", () =>
    Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format").get.call({}),
  );
  attempt("an heir", () => Object.create(numbers).format);
  attempt("a proxy", () =>
    new Proxy(numbers, {
      getPrototypeOf(target) {
        seen.push("getPrototypeOf");
        return Reflect.getPrototypeOf(target);
      },
    }).format(1),
  );
  attempt("a proxy of an heir", () =>
    new Proxy(Object.create(Intl.DateTimeFormat.prototype), {
      get(target, key, receiver) {
        seen.push("get");
        return Reflect.get(target, key, receiver);
      },
    }).format(0),
  );
  attempt("a date", () => dates.format(new Date(0)));
  attempt("a date, free", () => (0, dates.format)(new Date(86400000)));
  attempt("a date from a number", () => dates.format(0, "ignored"));
  attempt("dates, map", () => [new Date(0), new Date(86400000)].map(dates.format).join(" "));
  attempt("an invalid date", () => dates.format(NaN));
  attempt("a legacy receiver", () =>
    Intl.DateTimeFormat.call(Object.create(Intl.DateTimeFormat.prototype), "en-US", { timeZone: "UTC" }).format(
      new Date(0),
    ),
  );
  attempt("another locale at run time", () => new Intl.NumberFormat(["f", "r"].join("")).format(1234.5).length);
}
console.log(log.slice(0, 27).join("\n"));
console.log(
  log.slice(27).every((line, index) => line.replace(/ \d+$/, "") === log[index % 27].replace(/ \d+$/, "")),
  seen.length,
);
