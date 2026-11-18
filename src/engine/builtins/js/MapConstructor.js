function groupBy(items, callback) {
  if (@isUndefinedOrNull(items)) @throwTypeError("Map.groupBy requires that the first argument not be null or undefined");
  if (!@isCallable(callback)) @throwTypeError("Map.groupBy requires that the second argument must be a function");
  var iterable = items;
  if (!@isIterationPristine(items)) {
    var method = items.@@iterator;
    if (!@isCallable(method))
      @throwTypeError("Map.groupBy requires that the property of the first argument, items[Symbol.iterator] be a function");
    iterable = { @@iterator: () => method.@call(items) };
  }
  var groups = new @Map();
  var index = 0;
  for (var item of iterable) {
    if (index >= @MAX_SAFE_INTEGER) @throwTypeError("The number of iterations exceeds 2**53 - 1");
    var key = callback(item, index++);
    var group = groups.@get(key);
    if (group) @arrayPush(group, item);
    else groups.@set(key, [item]);
  }
  return groups;
}
