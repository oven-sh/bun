// The methods of a class that extends Map iterate each other's generators: one filters, one yields pairs, one passes them to a callback.
class Cache extends Map {
  _size = 0;
  _cache = new Map();
  _oldCache = new Map();
  _maxSize;
  _maxAge;
  _onEviction;

  constructor(options = {}) {
    super();
    if (!(options.maxSize && options.maxSize > 0)) throw new TypeError("`maxSize` must be a number greater than 0");
    this._maxSize = options.maxSize;
    this._maxAge = options.maxAge || Number.POSITIVE_INFINITY;
    this._onEviction = options.onEviction;
  }
  _emitEvictions(cache) {
    if (typeof this._onEviction !== "function") return;
    for (const [key, item] of cache) this._onEviction(key, item.value);
  }
  _deleteIfExpired(key, item) {
    if (typeof item.expiry === "number" && item.expiry <= Date.now()) {
      if (typeof this._onEviction === "function") this._onEviction(key, item.value);
      return this.delete(key);
    }
    return false;
  }
  _getOrDeleteIfExpired(key, item) {
    if (this._deleteIfExpired(key, item) === false) return item.value;
  }
  _getItemValue(key, item) {
    return item.expiry ? this._getOrDeleteIfExpired(key, item) : item.value;
  }
  _peek(key, cache) {
    return this._getItemValue(key, cache.get(key));
  }
  _set(key, value) {
    this._cache.set(key, value);
    this._size++;
    if (this._size >= this._maxSize) {
      this._size = 0;
      this._emitEvictions(this._oldCache);
      this._oldCache = this._cache;
      this._cache = new Map();
    }
  }
  _moveToRecent(key, item) {
    this._oldCache.delete(key);
    this._set(key, item);
  }
  *_entriesAscending() {
    for (const item of this._oldCache) {
      const [key, value] = item;
      if (!this._cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value);
        if (deleted === false) yield item;
      }
    }
    for (const item of this._cache) {
      const [key, value] = item;
      const deleted = this._deleteIfExpired(key, value);
      if (deleted === false) yield item;
    }
  }
  get(key) {
    if (this._cache.has(key)) return this._getItemValue(key, this._cache.get(key));
    if (this._oldCache.has(key)) {
      const item = this._oldCache.get(key);
      if (this._deleteIfExpired(key, item) === false) {
        this._moveToRecent(key, item);
        return item.value;
      }
    }
  }
  set(key, value, { maxAge = this._maxAge } = {}) {
    const expiry = typeof maxAge === "number" && maxAge !== Number.POSITIVE_INFINITY ? Date.now() + maxAge : undefined;
    if (this._cache.has(key)) this._cache.set(key, { value, expiry });
    else this._set(key, { value, expiry });
    return this;
  }
  has(key) {
    if (this._cache.has(key)) return !this._deleteIfExpired(key, this._cache.get(key));
    if (this._oldCache.has(key)) return !this._deleteIfExpired(key, this._oldCache.get(key));
    return false;
  }
  peek(key) {
    if (this._cache.has(key)) return this._peek(key, this._cache);
    if (this._oldCache.has(key)) return this._peek(key, this._oldCache);
  }
  delete(key) {
    const deleted = this._cache.delete(key);
    if (deleted) this._size--;
    return this._oldCache.delete(key) || deleted;
  }
  clear() {
    this._cache.clear();
    this._oldCache.clear();
    this._size = 0;
  }
  resize(newSize) {
    const items = [...this._entriesAscending()];
    const removeCount = items.length - newSize;
    if (removeCount < 0) {
      this._cache = new Map(items);
      this._oldCache = new Map();
      this._size = items.length;
    } else {
      if (removeCount > 0) this._emitEvictions(items.slice(0, removeCount));
      this._oldCache = new Map(items.slice(removeCount));
      this._cache = new Map();
      this._size = 0;
    }
    this._maxSize = newSize;
  }
  *keys() {
    for (const [key] of this) yield key;
  }
  *values() {
    for (const [, value] of this) yield value;
  }
  *[Symbol.iterator]() {
    for (const item of this._cache) {
      const [key, value] = item;
      const deleted = this._deleteIfExpired(key, value);
      if (deleted === false) yield [key, value.value];
    }
    for (const item of this._oldCache) {
      const [key, value] = item;
      if (!this._cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value);
        if (deleted === false) yield [key, value.value];
      }
    }
  }
  *entriesDescending() {
    let items = [...this._cache];
    for (let i = items.length - 1; i >= 0; --i) {
      const item = items[i];
      const [key, value] = item;
      const deleted = this._deleteIfExpired(key, value);
      if (deleted === false) yield [key, value.value];
    }
    items = [...this._oldCache];
    for (let i = items.length - 1; i >= 0; --i) {
      const item = items[i];
      const [key, value] = item;
      if (!this._cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value);
        if (deleted === false) yield [key, value.value];
      }
    }
  }
  *entriesAscending() {
    for (const [key, value] of this._entriesAscending()) yield [key, value.value];
  }
  get size() {
    if (!this._size) return this._oldCache.size;
    let oldCacheSize = 0;
    for (const key of this._oldCache.keys()) if (!this._cache.has(key)) oldCacheSize++;
    return Math.min(this._size + oldCacheSize, this._maxSize);
  }
  get maxSize() {
    return this._maxSize;
  }
  entries() {
    return this.entriesAscending();
  }
  forEach(callbackFunction, thisArgument = this) {
    for (const [key, value] of this.entriesAscending()) callbackFunction.call(thisArgument, value, key, this);
  }
  get [Symbol.toStringTag]() {
    return JSON.stringify([...this.entriesAscending()]);
  }
}

const evicted = [];
const cache = new Cache({ maxSize: 3, onEviction: (key, value) => evicted.push(key + "=" + value) });
for (let i = 0; i < 40; i++) {
  cache.set("k" + (i % 11), i);
  if (i % 3 === 0) cache.get("k" + (i % 5));
  if (i % 7 === 0) cache.delete("k" + (i % 4));
}
const seen = [];
cache.forEach((value, key, map) => seen.push(key, value, map === cache));
cache.forEach(function (value) {
  seen.push(this.name + value);
}, { name: "this" });
console.log(seen.join(), evicted.length, evicted.slice(-3).join());
console.log([...cache].join(" "), [...cache.entriesDescending()].join(" "), [...cache.entries()].join(" "), [...cache.keys()].join(), [...cache.values()].join());
cache.resize(2);
console.log(cache.size, cache.maxSize, String(cache), [...cache.entriesAscending()].join(" "));
cache.resize(9);
cache.set("last", 1, { maxAge: -1 });
console.log(cache.has("last"), cache.peek("k1"), [...cache.entriesAscending()].length);
try {
  cache.forEach(() => {
    throw new Error("stopped");
  });
} catch (error) {
  console.log(error.message);
}
console.log(Object.prototype.toString.call(cache));

class Recent extends Map {
  constructor() {
    super();
    this.cache = new Map();
  }
  *ascending() {
    for (const item of this.cache) yield item;
  }
  *entriesAscending() {
    for (const [key, value] of this.ascending()) yield [key, value.value];
  }
  set(key, value) {
    this.cache.set(key, { value });
    return this;
  }
}
class Replaced extends Recent {
  *ascending() {
    yield ["replaced", { value: 1 }];
    yield* super.ascending();
  }
}
for (const recent of [new Recent(), new Replaced(), new Recent()]) {
  for (let i = 0; i < 8; i++) recent.set("k" + i, i);
  console.log([...recent.entriesAscending()].join("|"));
  recent.ascending = function* () {
    yield ["own", { value: 2 }];
  };
  console.log([...recent.entriesAscending()].join("|"));
}
