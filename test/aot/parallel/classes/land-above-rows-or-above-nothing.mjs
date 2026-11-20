// STATISTIC: RowSumNests >= 1
// STATISTIC: TiledRowNests >= 1
// STATISTIC: LoopsVersionedForOtherClass >= 2
// Land lies above a list or above nothing: a meadow keeps the heights of its spots in rows of its own, a slope reckons them. What a loop asks of land that comes from elsewhere is asked of either in a version of its own; the gaps
// between the spots of a row and a fence that runs down the other land are added up for each row.
const land = Above => class Land extends Above {
  roughness(from, to) {
    const wide = this.wide, deep = this.deep;
    const fence = new Array(deep);
    for (let x = 0; x < wide; x++) {
      for (let y = 0; y < deep; y++) fence[y] = from.heightAt(x, y);
      for (let y = 0; y < deep; y++) {
        let all = 0;
        for (let z = 0; z < wide; z++) {
          const gap = this.heightAt(z, y) - fence[z];
          all += gap * gap;
        }
        to.put(x, y, all);
      }
    }
    return to;
  }
  easing(from, to) {
    const wide = this.wide, deep = this.deep;
    const fence = new Array(deep);
    for (let x = 0; x < wide; x++) {
      for (let y = 0; y < deep; y++) fence[y] = from.heightAt(x, y);
      for (let y = 0; y < deep; y++) {
        let ease = 0.5;
        for (let z = 0; z < wide; z++) ease = ease / 2 + (this.heightAt(z, y) - fence[z]) * 3;
        to.put(x, y, ease);
      }
    }
    return to;
  }
  raisedBy(from) {
    let spots = 0;
    for (let y = 0; y < this.deep; y++) {
      for (let x = 0; x < this.wide; x++) {
        this.put(x, y, this.heightAt(x, y) + from.heightAt(x, y));
        spots++;
      }
    }
    return spots;
  }
  under(from) {
    let all = 0;
    for (let y = 0; y < from.deep; y++) for (let x = 0; x < from.wide; x++) all += from.heightAt(x, y);
    return all;
  }
};
class Meadow extends land(Array) {
  constructor(wide, deep, height) {
    super(deep);
    this.wide = wide;
    this.deep = deep;
    for (let y = 0; y < deep; y++) {
      const row = [];
      for (let x = 0; x < wide; x++) row.push(height(x, y));
      this[y] = row;
    }
  }
  heightAt(x, y) {
    return this[y][x];
  }
  put(x, y, height) {
    this[y][x] = height;
    return this;
  }
}
class Slope extends land(Object) {
  constructor(wide, deep, step) {
    super();
    this.wide = wide;
    this.deep = deep;
    this.step = step;
  }
  heightAt(x, y) {
    return x * this.step + y;
  }
  put(x, y, height) {
    this.step = height / (x + y + 1);
    return this;
  }
}
const hills = (x, y) => x * 0.5 + y * 1.25 + 0.125;
const tell = value => (Object.is(value, -0) ? "-0" : typeof value === "number" ? String(value) : typeof value + " " + String(value));
function told(work) {
  try {
    return tell(work());
  } catch (error) {
    return error.constructor.name;
  }
}
const spots = at => (at instanceof Meadow ? Array.from(at, row => Array.from(row, tell).join(" ")).join(" / ") : tell(at.step));
const short = text => {
  let hash = 7;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `${hash} ${text.length} ${text.slice(0, 90)}`;
};
globalThis.country = { Meadow, Slope };
// what is laid under these names from outside is no method of the file
const [heightAt, put, wide, deep] = JSON.parse('["heightAt", "put", "wide", "deep"]');
const kinds = {
  "hills": n => new country.Meadow(n, n, hills),
  "steps": n => new country.Meadow(n, n, (x, y) => x * 3 - y),
  "flat": n => new country.Meadow(n, n, () => -0),
  "a slope": n => new country.Slope(n, n, 0.75),
  "a wide one": n => new country.Meadow(n + 2, n, hills),
  "a deep one": n => new country.Meadow(n, n + 2, hills),
  "unknown spots": n => new country.Meadow(n, n, (x, y) => (x === 1 && y === 2 ? NaN : hills(x, y))),
  "holes": n => {
    const at = new country.Meadow(n, n, hills);
    if (n > 1) delete at[1][0];
    return at;
  },
  "words": n => new country.Meadow(n, n, (x, y) => (x === 2 && y === 0 ? "7" : hills(x, y))),
  "a short row": n => {
    const at = new country.Meadow(n, n, hills);
    at[n - 1].length = n >> 1;
    return at;
  },
  "a shared row": n => {
    const at = new country.Meadow(n, n, hills);
    at[0] = at[n - 1];
    return at;
  },
  "a frozen row": n => {
    const at = new country.Meadow(n, n, hills);
    Object.freeze(at[n >> 1]);
    return at;
  },
  "bytes in a row": n => {
    const at = new country.Meadow(n, n, (x, y) => x + y);
    at[n - 1] = Uint8Array.from(at[n - 1]);
    return at;
  },
  "its own hand": n => {
    const at = new country.Meadow(n, n, hills);
    Reflect.defineProperty(at, heightAt, { value: (x, y) => x - y });
    return at;
  },
  "neither": n => Object.fromEntries([[wide, n], [deep, n], [heightAt, (x, y) => x * y], [put, () => 1]]),
  "through a proxy": n => new Proxy(new country.Meadow(n, n, hills), {}),
  "no land": () => Object.fromEntries([[wide, 2], [deep, 2]]),
};
function round(label, size) {
  for (const [first, make] of Object.entries(kinds)) {
    const lines = [];
    for (const [second, other] of Object.entries(kinds)) {
      for (const way of ["roughness", "easing"]) {
        const at = make(size), to = new country.Meadow(size, size, () => 0.5);
        lines.push(second, told(() => (country.Meadow.prototype[way].call(at, other(size), to), 1)), spots(to));
        const into = other(size);
        lines.push(told(() => (country.Meadow.prototype[way].call(new country.Meadow(size, size, hills), at, into), 1)), spots(into.deep && into.put ? into : to));
      }
      const at = make(size);
      lines.push(told(() => country.Meadow.prototype.raisedBy.call(at, other(size))), told(() => country.Slope.prototype.under.call(at, other(size))), at.deep ? spots(at) : "none");
    }
    console.log(label, size, first, short(lines.join(" | ")));
  }
}
for (let again = 0; again < 30; again++) {
  const meadow = new country.Meadow(6, 6, hills), other = new country.Meadow(6, 6, (x, y) => y * 0.25 - x), slope = new country.Slope(6, 6, again / 16);
  for (const from of [meadow, other, slope]) {
    const to = new country.Meadow(6, 6, () => 0.5);
    meadow.roughness(from, to);
    other.easing(from, to);
    if (again === 29) console.log(spots(to), tell(meadow.under(from)), slope.raisedBy(from), other.raisedBy(from), spots(other));
  }
}
for (const size of [1, 4, 9]) round("first", size);
Reflect.defineProperty(country.Slope.prototype, heightAt, { value(x, y) { return y - x * this.step; } });
round("another slope", 5);
Reflect.defineProperty(country.Meadow.prototype, heightAt, { value(x, y) { return this[x]?.[y] ?? 0; } });
round("another meadow", 5);
