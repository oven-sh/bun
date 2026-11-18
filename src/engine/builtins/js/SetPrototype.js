function forEach(callback /*, thisArg */) {
  if (!@isSet(this)) @throwTypeError("Set operation called on non-Set object");
  if (!@isCallable(callback)) @throwTypeError("Set.prototype.forEach callback must be a function");
  var thisArg = @argument(1);
  var place = @setStorage(this);
  var next = 0;
  for (;;) {
    place = @setIterationNext(place, next);
    if (place === @undefined) return;
    next = @setIterationEntry(place) + 1;
    var key = @setIterationEntryKey(place);
    callback.@call(thisArg, key, key, this);
  }
}
