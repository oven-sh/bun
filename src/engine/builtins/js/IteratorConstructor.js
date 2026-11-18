function from(value) {
  var iterator = @getIteratorFlattenable(value, false);
  var next = iterator.next;
  if (@isIteratorInstance(iterator)) return iterator;
  return @wrapForValidIteratorCreate(iterator, next);
}

// @private
function* concatenatedValues(iterables, methods) {
  for (var i = 0; i < iterables.length; i++) {
    var iterator = methods[i].@call(iterables[i]);
    if (!@isObject(iterator)) @throwTypeError("Iterator.concat expects all arguments to be iterable");
    for (var value of @iterableWithMethod(iterator, @iteratorPrototypeSymbolIterator)) yield value;
  }
}

function concat(...iterables) {
  var methods = [];
  for (var i = 0; i < iterables.length; i++) {
    var iterable = iterables[i];
    if (!@isObject(iterable)) @throwTypeError("Iterator.concat expects all arguments to be objects");
    var method = iterable.@@iterator;
    if (!@isCallable(method)) @throwTypeError("Iterator.concat expects all arguments to be iterable");
    @arrayPush(methods, method);
  }
  return @iteratorHelperCreate(@concatenatedValues(iterables, methods), null);
}

// An iterator becomes null in the list when it is done or has failed.
// @private
function* zippedValues(iterators, nextMethods, mode, padding, keys, closer) {
  var count = iterators.length;
  var openCount = count;
  while (openCount) {
    var results = keys ? { __proto__: null } : @newArrayWithSize(count);
    for (var i = 0; i < count; i++) {
      var iterator = iterators[i];
      var done = true;
      var value;
      if (iterator !== null) {
        try {
          var result = @iteratorGenericNext(nextMethods[i], iterator);
          done = result.done;
          if (!done) value = result.value;
        } catch (error) {
          iterators[i] = null;
          @closeIteratorsQuietly(iterators, count);
          throw error;
        }
        if (done) {
          iterators[i] = null;
          if (mode === "shortest") return @closeIterators(iterators);
          if (mode === "strict") {
            while (i === 0 && done && --openCount) {
              var other = count - openCount;
              try {
                done = @iteratorGenericNext(nextMethods[other], iterators[other]).done;
              } catch (error) {
                iterators[other] = null;
                @closeIteratorsQuietly(iterators, count);
                throw error;
              }
              if (done) iterators[other] = null;
            }
            if (!openCount) return;
            @closeIteratorsQuietly(iterators, count);
            @throwTypeError("Iterator.zip strict mode requires all iterables to have the same number of elements");
          }
          if (!--openCount) return;
        }
      }
      @putByValDirect(results, keys ? keys[i] : i, done ? padding[i] : value);
    }
    @ifAbruptCloseIterator(closer, yield results);
  }
}

// IteratorZip
// @private
function zipIterators(iterators, nextMethods, mode, padding, keys) {
  var closer = {
    __proto__: null,
    return() {
      @closeIterators(iterators);
      return this;
    },
  };
  return @iteratorHelperCreate(@zippedValues(iterators, nextMethods, mode, padding, keys, closer), closer);
}

// @private
function zipOptions(options) {
  if (options === @undefined) return { mode: "shortest", padding: @undefined };
  if (!@isObject(options)) @throwTypeError("Expected object or null for options argument");
  var mode = options.mode;
  if (mode === @undefined) mode = "shortest";
  if (mode !== "shortest" && mode !== "longest" && mode !== "strict")
    @throwTypeError('Expected "shortest", "longest" or "strict" for options.mode');
  var padding;
  if (mode === "longest") {
    padding = options.padding;
    if (padding !== @undefined && !@isObject(padding)) @throwTypeError("Expected options.padding to be an object");
  }
  return { mode, padding };
}

function zip(iterables /*, options */) {
  if (!@isObject(iterables)) @throwTypeError("Iterator.zip expects its first argument to be an object");
  var options = @zipOptions(@argument(1));
  var iterators = [];
  var nextMethods = [];
  var padding = [];
  var source = iterables;
  var input, failedToOpen;
  try {
    // First the iterables, then the padding.
    for (var isPadding = false; source !== @undefined; isPadding = true) {
      var method = source.@@iterator;
      if (@isUndefinedOrNull(method)) @throwTypeError("Symbol.iterator is not defined");
      if (!@isCallable(method)) @throwTypeError("Symbol.iterator is not callable");
      input = method.@call(source);
      if (!@isObject(input)) @throwTypeError("Iterator is not an object");
      var inputNext = input.next;
      var done = false;
      while (!isPadding || padding.length < iterators.length) {
        var result = @iteratorGenericNext(inputNext, input);
        if ((done = result.done)) break;
        var value = result.value;
        if (isPadding) @arrayPush(padding, value);
        else {
          failedToOpen = true;
          var iterator = @getIteratorFlattenable(value, true);
          @arrayPush(nextMethods, iterator.next);
          @arrayPush(iterators, iterator);
          failedToOpen = false;
        }
      }
      if (!done) @iteratorGenericClose(input);
      source = isPadding ? @undefined : options.padding;
    }
  } catch (error) {
    @closeIteratorsQuietly(iterators, iterators.length);
    if (failedToOpen) @closeIteratorQuietly(input);
    throw error;
  }
  while (padding.length < iterators.length) @arrayPush(padding, @undefined);
  return @zipIterators(iterators, nextMethods, options.mode, padding, null);
}

function zipKeyed(iterables /*, options */) {
  if (!@isObject(iterables)) @throwTypeError("Iterator.zipKeyed expects its first argument to be an object");
  var options = @zipOptions(@argument(1));
  var iterators = [];
  var nextMethods = [];
  var padding = [];
  var keys = [];
  var allKeys = @ownKeys(iterables);
  try {
    for (var i = 0; i < allKeys.length; i++) {
      var key = allKeys[i];
      var descriptor = @Object.@getOwnPropertyDescriptor(iterables, key);
      if (descriptor === @undefined || !descriptor.enumerable) continue;
      var value = iterables[key];
      if (value === @undefined) continue;
      var iterator = @getIteratorFlattenable(value, true);
      @arrayPush(nextMethods, iterator.next);
      @arrayPush(iterators, iterator);
      @arrayPush(keys, key);
    }
    for (var i = 0; i < keys.length; i++)
      @arrayPush(padding, options.padding === @undefined ? @undefined : options.padding[keys[i]]);
  } catch (error) {
    @closeIteratorsQuietly(iterators, iterators.length);
    throw error;
  }
  return @zipIterators(iterators, nextMethods, options.mode, padding, keys);
}
