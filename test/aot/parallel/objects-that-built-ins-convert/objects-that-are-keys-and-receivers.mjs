// A built-in reads an object as a key, or hands it to a function of the program as `this`.
class Parcel {
  constructor(code) {
    this.code = code;
    this.scans = 0;
  }
  toString() {
    this.scans++;
    return this.code;
  }
}

class Total {
  constructor(start) {
    this.start = start;
    this.count = 0.5;
  }
}

function own(parcel, table) {
  const before = parcel.scans;
  const found = Object.hasOwn(table, parcel);
  return found + " " + before + " " + parcel.scans;
}

function read(parcel, table) {
  const before = parcel.scans;
  const value = Reflect.get(table, parcel) + Reflect.get(table, parcel);
  return value + " " + before + " " + parcel.scans;
}

function written(parcel) {
  const table = {};
  Object.defineProperty(table, parcel, { value: parcel.scans, enumerable: true });
  return JSON.stringify(table) + parcel.scans + Reflect.has(table, parcel) + parcel.scans;
}

function named(parcel) {
  const symbol = Symbol.for(parcel);
  return symbol.description + parcel.scans;
}

function tallied(total, list) {
  const before = total.start;
  const same = Array.from(
    list,
    function (value) {
      this.start += value;
      return value;
    },
    total,
  );
  return before + " " + same.length + " " + total.start;
}

function addedIn(total, list) {
  const before = total.start;
  Array.prototype.forEach.call(
    list,
    function (value) {
      this.count += value;
    },
    total,
  );
  return before + " " + total.start + " " + total.count;
}

function grow(step) {
  this.start += step;
  return this.start;
}

function grown(total) {
  const before = total.start;
  let last = 0;
  for (let turn = 0; turn < 3; turn++) {
    try {
      if (turn === 1) throw new Error("x");
    } catch {
      last = Reflect.apply(grow, total, [4]);
    }
  }
  return before + " " + last + " " + total.start;
}

console.log(own(new Parcel("a"), { a: 1 }));
console.log(read(new Parcel("b"), { b: 2 }));
console.log(written(new Parcel("c")));
console.log(named(new Parcel("d")));
console.log(tallied(new Total(1), [2, 3]));
console.log(addedIn(new Total(1), [2, 3]));
console.log(grown(new Total(7)));
