// One function makes, for a holder and a name, a closure that redefines the member and one that puts it back. Both reach their caller through a spread, and the program evaluates text that it makes at run time.
function parses(text, results, tick) {
  for (let i = 0; i < 3; i++) {
    tick(i);
    results.push(JSON.parse(text) + 1);
  }
  return "done";
}
function serializes(date, results, tick) {
  for (let i = 0; i < 3; i++) {
    tick(i);
    results.push(JSON.stringify([date]));
  }
  return "done";
}
function joins(error, results, tick) {
  for (let i = 0; i < 3; i++) {
    tick(i);
    results.push("" + error);
  }
  return "done";
}
function during(use, value, put, restore) {
  const results = [];
  let end;
  try {
    end = use(value, results, i => {
      if (i === 1) put();
      if (i === 2) restore();
    });
  } catch (error) {
    end = "threw " + error.constructor.name;
  }
  return results.join(" ") + " " + end;
}
function member(holder, name, value) {
  const had = Object.getOwnPropertyDescriptor(holder, name);
  return [
    () => Object.defineProperty(holder, name, { value, writable: true, configurable: true }),
    () => (had ? Object.defineProperty(holder, name, had) : delete holder[name]),
  ];
}
class Stamp extends Date {}
console.log(during(serializes, new Stamp(0), ...member(Stamp.prototype, "toJSON", function () { return 5; })));
console.log(during(parses, "7", ...member(JSON, "parse", text => text)));
console.log(during(serializes, new Date(0), ...member(JSON, "stringify", value => value.length)));
console.log(during(joins, new RangeError("r"), ...member(Error.prototype, "toString", function () { return "replaced " + this.message; })));
console.log(during(joins, new RangeError("r"), ...member(RangeError.prototype, "name", "Renamed")));
console.log((0, eval)("1 + " + process.argv.length) > 1);
