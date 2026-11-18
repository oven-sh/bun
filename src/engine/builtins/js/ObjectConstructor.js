function fromEntries(iterable) {
  "use strict";
  var result = {};
  for (var entry of iterable) {
    if (!@isObject(entry)) @throwTypeError("Object.fromEntries requires the first iterable parameter yields objects");
    var key = entry[0];
    @putByValDirect(result, key, entry[1]);
  }
  return result;
}

function groupBy(items, callback) {
  "use strict";
  if (@isUndefinedOrNull(items)) @throwTypeError("Object.groupBy requires that the first argument not be null or undefined");
  if (!@isCallable(callback)) @throwTypeError("Object.groupBy requires that the second argument must be a function");
  var method = items.@@iterator;
  if (!@isCallable(method))
    @throwTypeError("Object.groupBy requires that the property of the first argument, items[Symbol.iterator] be a function");
  var iterator = method.@call(items);
  if (!@isObject(iterator)) @throwTypeError("Iterator result interface is not an object.");
  var next = iterator.next;
  var groups = @Object.@create(null);
  for (var index = 0; ; index++) {
    var step = @iteratorGenericNext(next, iterator);
    if (step.done) return groups;
    var item = step.value;
    var key;
    @ifAbruptCloseIterator(iterator, (key = @toPropertyKey(callback.@call(@undefined, item, index))));
    var group = groups[key];
    if (group) @arrayPush(group, item);
    else @putByValDirect(groups, key, [item]);
  }
}
