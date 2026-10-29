var store = { "a.txt": "alpha", "b.txt": "beta" };

function read(name, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (typeof options === "string") options = { encoding: options };
  if (!options) options = {};
  var limit = options.limit || 100;
  var text = store[name];
  if (text === undefined) return callback(new Error("no such entry"));
  if (options.encoding === "upper") text = text.toUpperCase();
  return callback(null, text.slice(0, limit), limit + 1);
}

function readAll(names, options, callback) {
  if (!Array.isArray(names)) names = [names];
  if (arguments.length === 2) {
    callback = options;
    options = undefined;
  }
  var results = [];
  for (var i = 0; i < names.length; i++) {
    read(names[i], options, function (error, text) {
      results.push(error ? error.message.length : text);
    });
  }
  return callback(results);
}

function range(start, end, step) {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  step = step || 1;
  var out = [];
  for (var i = start; i < end; i += step) out.push(i);
  return out;
}

function on(target, name, listener) {
  if (typeof name === "object") {
    var count = 0;
    for (var key in name) count += on(target, key, name[key]);
    return count;
  }
  (target[name] || (target[name] = [])).push(listener);
  return 1;
}

module.exports = { read: read, readAll: readAll, range: range, on: on };
