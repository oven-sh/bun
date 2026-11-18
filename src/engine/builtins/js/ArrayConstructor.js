function from(items /*, mapFn, thisArg */) {
  var mapFn = @argument(1);
  var thisArg;
  if (mapFn !== @undefined) {
    if (!@isCallable(mapFn)) @throwTypeError("Array.from requires that the second argument, when provided, be a function");
    thisArg = @argument(2);
  }
  var arrayLike = @toObject(items, "Array.from requires an array-like object - not null or undefined");
  var result;
  if (mapFn === @undefined) {
    result = @arrayFromFastWithoutMapFn(this, items);
    if (result) return result;
  }
  var isDerived = this !== @Array && @isConstructor(this);
  var index = 0;

  var method = items.@@iterator;
  if (!@isUndefinedOrNull(method)) {
    if (!@isCallable(method))
      @throwTypeError("Array.from requires that the property of the first argument, items[Symbol.iterator], when exists, be a function");
    result = isDerived ? new this() : [];
    for (var value of @iterableWithMethod(items, method)) {
      if (index >= @MAX_SAFE_INTEGER) @throwTypeError("Length exceeded the maximum array length");
      @putByValDirect(result, index, mapFn === @undefined ? value : mapFn.@call(thisArg, value, index));
      index++;
    }
    result.length = index;
    return result;
  }

  var length = @toLength(arrayLike.length);
  result = isDerived ? new this(length) : @newArrayWithSize(length);
  for (; index < length; index++) {
    var value = arrayLike[index];
    @putByValDirect(result, index, mapFn === @undefined ? value : mapFn.@call(thisArg, value, index));
  }
  result.length = length;
  return result;
}

// @private
// @visibility PrivateRecursive
async function arrayFromAsyncIterator(iterator, mapFn, thisArg) {
  if (!@isObject(iterator)) @throwTypeError("Iterator result interface is not an object.");
  var next = iterator.next;
  var result = this !== @Array && @isConstructor(this) ? new this() : [];
  for (var index = 0; ; index++) {
    var step = await next.@call(iterator);
    if (!@isObject(step)) @throwTypeError("Iterator result interface is not an object.");
    if (step.done) break;
    var value = step.value;
    try {
      if (index >= @MAX_SAFE_INTEGER) @throwTypeError("Length exceeded the maximum array length");
      if (mapFn !== @undefined) value = await mapFn.@call(thisArg, value, index);
      @putByValDirect(result, index, value);
    } catch (error) {
      try {
        var close = iterator.return;
        if (!@isUndefinedOrNull(close)) await close.@call(iterator);
      } catch {}
      throw error;
    }
  }
  result.length = index;
  return result;
}

// @private
// @visibility PrivateRecursive
async function arrayFromAsyncArrayLike(items, mapFn, thisArg) {
  var arrayLike = @toObject(items, "Array.fromAsync requires an array-like object - not null or undefined");
  var length = @toLength(arrayLike.length);
  var result = this !== @Array && @isConstructor(this) ? new this(length) : @newArrayWithSize(length);
  for (var index = 0; index < length; index++) {
    var value = await arrayLike[index];
    if (mapFn !== @undefined) value = await mapFn.@call(thisArg, value, index);
    @putByValDirect(result, index, value);
  }
  result.length = length;
  return result;
}

function fromAsync(items /*, mapFn, thisArg */) {
  try {
    var mapFn = @argument(1);
    var thisArg;
    if (mapFn !== @undefined) {
      if (!@isCallable(mapFn))
        @throwTypeError("Array.fromAsync requires that the second argument, when provided, be a function");
      thisArg = @argument(2);
    }
    var method = items.@@asyncIterator;
    var isSync = @isUndefinedOrNull(method);
    if (isSync) {
      method = items.@@iterator;
      if (@isUndefinedOrNull(method)) return @arrayFromAsyncArrayLike.@call(this, items, mapFn, thisArg);
      if (!@isCallable(method))
        @throwTypeError("Array.fromAsync requires that the property of the first argument, items[Symbol.iterator], when exists, be a function");
    } else if (!@isCallable(method))
      @throwTypeError("Array.fromAsync requires that the property of the first argument, items[Symbol.asyncIterator], when exists, be a function");
    var iterator = method.@call(items);
    if (isSync) iterator = @asyncFromSyncIteratorCreate(iterator);
    return @arrayFromAsyncIterator.@call(this, iterator, mapFn, thisArg);
  } catch (reason) {
    var promise = @newPromise();
    @rejectPromiseWithFirstResolvingFunctionCallCheck(promise, reason);
    return promise;
  }
}
