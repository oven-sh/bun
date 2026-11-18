// @private
function* mappedValues(iterator, next, mapper) {
  for (var counter = 0; ; counter++) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) return;
    var value = result.value;
    @ifAbruptCloseIterator(iterator, yield mapper(value, counter));
  }
}

function map(mapper) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.map requires that |this| be an Object.");
  if (!@isCallable(mapper)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.map callback must be a function.");
  }
  return @iteratorHelperCreate(@mappedValues(this, this.next, mapper), this);
}

// @private
function* filteredValues(iterator, next, predicate) {
  for (var counter = 0; ; counter++) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) return;
    var value = result.value;
    @ifAbruptCloseIterator(iterator, predicate(value, counter) && (yield value));
  }
}

function filter(predicate) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.filter requires that |this| be an Object.");
  if (!@isCallable(predicate)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.filter callback must be a function.");
  }
  return @iteratorHelperCreate(@filteredValues(this, this.next, predicate), this);
}

// @private
function iteratorLimit(iterator, limit, method) {
  var number;
  @ifAbruptCloseIterator(iterator, (number = @toNumber(limit)));
  if (number !== number) {
    @closeIteratorQuietly(iterator);
    @throwRangeError(method + " argument must not be NaN.");
  }
  number = @toIntegerOrInfinity(number);
  if (number < 0 || (number > @MAX_SAFE_INTEGER && number !== @Infinity)) {
    @closeIteratorQuietly(iterator);
    @throwRangeError(method + " argument must be non-negative safe integer or +Infinity");
  }
  return number;
}

// @private
function* takenValues(iterator, next, remaining) {
  for (; remaining > 0; remaining--) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) return;
    var value = result.value;
    @ifAbruptCloseIterator(iterator, yield value);
  }
  @iteratorGenericClose(iterator);
}

function take(limit) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.take requires that |this| be an Object.");
  var count = @iteratorLimit(this, limit, "Iterator.prototype.take");
  return @iteratorHelperCreate(@takenValues(this, this.next, count), this);
}

// @private
function* remainingValues(iterator, next, dropped) {
  for (; dropped > 0; dropped--) {
    if (@iteratorGenericNext(next, iterator).done) return;
  }
  for (;;) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) return;
    var value = result.value;
    @ifAbruptCloseIterator(iterator, yield value);
  }
}

function drop(limit) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.drop requires that |this| be an Object.");
  var count = @iteratorLimit(this, limit, "Iterator.prototype.drop");
  return @iteratorHelperCreate(@remainingValues(this, this.next, count), this);
}

// @private
function* flatMappedValues(iterator, next, mapper) {
  for (var counter = 0; ; counter++) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) return;
    var value = result.value;
    var inner, innerNext;
    @ifAbruptCloseIterator(iterator, ((inner = @getIteratorFlattenable(mapper(value, counter), true)), (innerNext = inner.next)));
    for (;;) {
      var done;
      @ifAbruptCloseIterator(iterator, ((result = @iteratorGenericNext(innerNext, inner)), (done = result.done) || (value = result.value)));
      if (done) break;
      @ifAbruptCloseIterator(iterator, @ifAbruptCloseIterator(inner, yield value));
    }
  }
}

function flatMap(mapper) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.flatMap requires that |this| be an Object.");
  if (!@isCallable(mapper)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.flatMap callback must be a function.");
  }
  return @iteratorHelperCreate(@flatMappedValues(this, this.next, mapper), this);
}

function some(predicate) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.some requires that |this| be an Object.");
  if (!@isCallable(predicate)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.some callback must be a function.");
  }
  var counter = 0;
  for (var value of @iterableWithMethod(this, @iteratorPrototypeSymbolIterator)) {
    if (predicate(value, counter++)) return true;
  }
  return false;
}

function every(predicate) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.every requires that |this| be an Object.");
  if (!@isCallable(predicate)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.every callback must be a function.");
  }
  var counter = 0;
  for (var value of @iterableWithMethod(this, @iteratorPrototypeSymbolIterator)) {
    if (!predicate(value, counter++)) return false;
  }
  return true;
}

function find(predicate) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.find requires that |this| be an Object.");
  if (!@isCallable(predicate)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.find callback must be a function.");
  }
  var counter = 0;
  for (var value of @iterableWithMethod(this, @iteratorPrototypeSymbolIterator)) {
    if (predicate(value, counter++)) return value;
  }
}

function reduce(reducer /*, initialValue */) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.reduce requires that |this| be an Object.");
  if (!@isCallable(reducer)) {
    @closeIteratorQuietly(this);
    @throwTypeError("Iterator.prototype.reduce reducer argument must be a function.");
  }
  var hasAccumulator = @argumentCount() > 1;
  var accumulator = @argument(1);
  var counter = 0;
  for (var value of @iterableWithMethod(this, @iteratorPrototypeSymbolIterator)) {
    accumulator = hasAccumulator ? reducer(accumulator, value, counter) : value;
    hasAccumulator = true;
    counter++;
  }
  if (!hasAccumulator)
    @throwTypeError("Iterator.prototype.reduce requires an initial value or an iterator that is not done.");
  return accumulator;
}

// @private
function checkChunkSize(iterator, size, method) {
  if (typeof size !== "number" || size % 1 !== 0) {
    @closeIteratorQuietly(iterator);
    @throwTypeError(method + " requires that first argument be an integral Number.");
  }
  if (size < 1 || size > 4294967295) {
    @closeIteratorQuietly(iterator);
    @throwRangeError(method + " requires that first argument be between 1 and 2**32 - 1.");
  }
}

// @private
function* chunkedValues(iterator, next, size) {
  var chunk = [];
  for (;;) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) break;
    @arrayPush(chunk, result.value);
    if (chunk.length === size) {
      @ifAbruptCloseIterator(iterator, yield chunk);
      chunk = [];
    }
  }
  if (chunk.length) yield chunk;
}

function chunks(chunkSize) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.chunks requires that |this| be an Object.");
  @checkChunkSize(this, chunkSize, "Iterator.prototype.chunks");
  return @iteratorHelperCreate(@chunkedValues(this, this.next, chunkSize), this);
}

// @private
function* windowedValues(iterator, next, size, allowsPartial) {
  var ring = [];
  var oldest = 0;
  for (;;) {
    var result = @iteratorGenericNext(next, iterator);
    if (result.done) break;
    if (ring.length < size) {
      @arrayPush(ring, result.value);
      if (ring.length < size) continue;
    } else {
      ring[oldest] = result.value;
      if (++oldest === size) oldest = 0;
    }
    var window = @newArrayWithSize(size);
    for (var to = 0, from = oldest; to < size; to++) {
      @putByValDirect(window, to, ring[from]);
      if (++from === size) from = 0;
    }
    @ifAbruptCloseIterator(iterator, yield window);
  }
  if (allowsPartial && ring.length && ring.length < size) yield ring;
}

function windows(windowSize /*, undersized */) {
  if (!@isObject(this)) @throwTypeError("Iterator.prototype.windows requires that |this| be an Object.");
  @checkChunkSize(this, windowSize, "Iterator.prototype.windows");
  var undersized = @argument(1);
  if (undersized !== @undefined && undersized !== "only-full" && undersized !== "allow-partial") {
    @closeIteratorQuietly(this);
    @throwTypeError('Iterator.prototype.windows requires that second argument be "only-full" or "allow-partial".');
  }
  return @iteratorHelperCreate(@windowedValues(this, this.next, windowSize, undersized === "allow-partial"), this);
}

// @name [Symbol.dispose]
function dispose() {
  var method = this.return;
  if (!@isUndefinedOrNull(method)) method.@call(this);
}
