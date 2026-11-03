// `arguments` in a function that also has a rest parameter which it hands out or changes: the length and the named parameters need no object, the other elements are those of the call.
var queue = [];
function check(callback) {
  if (typeof callback !== "function") throw new TypeError("callback");
}
function later(callback, ...rest) {
  check(callback);
  queue.push({ callback, rest: arguments.length > 1 ? rest : undefined });
}
function changed(first, ...rest) {
  rest.push("pushed");
  rest[0] = "replaced";
  return [arguments.length, arguments[0], arguments[1], arguments[2], rest.length, rest[0]].join();
}
function changedByCallee(mutate, ...rest) {
  mutate(rest);
  return arguments.length + ":" + arguments[1] + ":" + Array.prototype.slice.call(arguments, 1).join("/");
}
function returned(flag, ...rest) {
  queue.push(rest);
  rest.length = 0;
  return flag ? arguments : arguments.length;
}
function forwarded(target, ...rest) {
  rest.reverse();
  return target.apply(null, arguments);
}
function written(first, ...rest) {
  queue.push(rest);
  arguments.length = 1;
  arguments[0] = "other";
  return [arguments.length, arguments[0], first, rest.length].join();
}
var sum = 0;
function add(a, b) {
  sum += (a | 0) + (b | 0);
}
for (var i = 0; i < 3000; i++) {
  later(add);
  later(add, i);
  later(add, i, 1);
  for (var task of queue) {
    if (task.rest === undefined) task.callback();
    else task.callback(...task.rest);
  }
  queue.length = 0;
}
console.log(sum);
console.log(changed(), changed(1), changed(1, 2), changed(1, 2, 3));
console.log(changedByCallee(function (list) { list[0] = "x"; list.push("y"); }, "a", "b"));
console.log(returned(false), returned(false, 1, 2), Array.from(returned(true, 1, 2)).join(), returned(true).length);
console.log(forwarded(function () { return Array.prototype.slice.call(arguments, 1).join(); }, 1, 2, 3));
console.log(written(), written(1), written(1, 2, 3));
try {
  later(1);
} catch (error) {
  console.log(error.message);
}
