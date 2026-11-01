// A least-recently-used cache: a Map beside a doubly linked list of ES5 objects, with numbers and with strings as keys, behind a closure that memoizes.
function Entry(key, value) {
  this.key = key;
  this.value = value;
  this.newer = null;
  this.older = null;
}

function LRU(limit) {
  this.limit = limit;
  this.size = 0;
  this.map = new Map();
  this.newest = null;
  this.oldest = null;
  this.hits = 0;
  this.misses = 0;
}

LRU.prototype._unlink = function (entry) {
  if (entry.newer) entry.newer.older = entry.older;
  else this.newest = entry.older;
  if (entry.older) entry.older.newer = entry.newer;
  else this.oldest = entry.newer;
  entry.newer = entry.older = null;
};

LRU.prototype._pushNewest = function (entry) {
  entry.older = this.newest;
  if (this.newest) this.newest.newer = entry;
  this.newest = entry;
  if (!this.oldest) this.oldest = entry;
};

LRU.prototype.get = function (key) {
  var entry = this.map.get(key);
  if (entry === undefined) {
    this.misses++;
    return undefined;
  }
  this.hits++;
  if (entry !== this.newest) {
    this._unlink(entry);
    this._pushNewest(entry);
  }
  return entry.value;
};

LRU.prototype.set = function (key, value) {
  var entry = this.map.get(key);
  if (entry !== undefined) {
    entry.value = value;
    if (entry !== this.newest) {
      this._unlink(entry);
      this._pushNewest(entry);
    }
    return this;
  }
  entry = new Entry(key, value);
  this.map.set(key, entry);
  this._pushNewest(entry);
  if (++this.size > this.limit) {
    var evicted = this.oldest;
    this._unlink(evicted);
    this.map.delete(evicted.key);
    this.size--;
  }
  return this;
};

function memoize(fn, cache) {
  return function (n) {
    var known = cache.get(n);
    if (known !== undefined) return known;
    var value = fn(n);
    cache.set(n, value);
    return value;
  };
}

function run(count) {
  var cache = new LRU(64);
  var names = new LRU(16);
  var square = memoize(function (n) {
    return n * n + 1;
  }, cache);
  var seed = 12345;
  var total = 0;
  for (var i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    total += square((seed >> 8) % 96);
    var name = "k" + ((seed >> 4) % 24);
    var length = names.get(name);
    if (length === undefined) names.set(name, (length = name.length));
    total += length;
  }
  return total + cache.hits * 3 + cache.misses + names.hits;
}

console.log(run(1200000));
