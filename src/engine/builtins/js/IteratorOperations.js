// @private
function collectForSpread(iterator, next) {
  var values = [];
  var count = 0;
  for (;;) {
    var result = next.@call(iterator);
    if (!@isObject(result)) @throwTypeError("Iterator result interface is not an object");
    if (result.done) return values;
    @putByValDirect(values, count++, result.value);
  }
}

// GetIteratorFlattenable, but for getting `next`.
// @private
function getIteratorFlattenable(value, rejectsStrings) {
  if (!@isObject(value) && (rejectsStrings || typeof value !== "string"))
    @throwTypeError("GetIteratorFlattenable expects its first argument to be an object" + (rejectsStrings ? "" : " or a string"));
  var method = value.@@iterator;
  var iterator = @isUndefinedOrNull(method) ? value : method.@call(value);
  if (!@isObject(iterator)) @throwTypeError("Iterator is not an object");
  return iterator;
}

// For a caller that is about to throw.
// @private
function closeIteratorQuietly(iterator) {
  try {
    @iteratorGenericClose(iterator);
  } catch {}
}

// IteratorCloseAll with a throw completion. Null stands for an iterator that is not open.
// @private
function closeIteratorsQuietly(iterators, count) {
  while (count--) {
    var iterator = iterators[count];
    if (iterator !== null) @closeIteratorQuietly(iterator);
  }
}

// The same, with any other completion.
// @private
function closeIterators(iterators) {
  for (var i = iterators.length; i--; ) {
    var iterator = iterators[i];
    if (iterator === null) continue;
    try {
      @iteratorGenericClose(iterator);
    } catch (error) {
      @closeIteratorsQuietly(iterators, i);
      throw error;
    }
  }
}
