function throughArguments(cb) { arguments[0] = arguments[1]; return cb(1); }
function throughCaller(cb) { return cb(2); }
function reassigned(cb, next) { var first = cb(3); cb = next; return first + cb(3); }
var hoisted = function (cb) { return cb(4); };
exports.sloppy = function (seen, other) {
  var out = [throughArguments(seen, seen), throughArguments(seen, other), throughCaller(seen), reassigned(seen, seen), reassigned(seen, other), hoisted(seen)];
  var table = { f: throughCaller };
  for (var key in table) out.push(table[key](other));
  hoisted = function (cb) { return "replaced" + cb(5); };
  out.push(hoisted(other));
  return out.join();
};
