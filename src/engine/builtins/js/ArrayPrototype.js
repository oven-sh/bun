function reduce(callback /*, initialValue */) {
  var array = @toObject(this, "Array.prototype.reduce requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.reduce callback must be a function");
  var accumulator;
  var i = 0;
  if (@argumentCount() > 1) accumulator = @argument(1);
  else {
    while (i < length && !(i in array)) i++;
    if (i >= length) @throwTypeError("reduce of empty array with no initial value");
    accumulator = array[i++];
  }
  for (; i < length; i++) {
    if (i in array) accumulator = callback(accumulator, array[i], i, array);
  }
  return accumulator;
}

function reduceRight(callback /*, initialValue */) {
  var array = @toObject(this, "Array.prototype.reduceRight requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.reduceRight callback must be a function");
  var accumulator;
  var i = length - 1;
  if (@argumentCount() > 1) accumulator = @argument(1);
  else {
    while (i >= 0 && !(i in array)) i--;
    if (i < 0) @throwTypeError("reduceRight of empty array with no initial value");
    accumulator = array[i--];
  }
  for (; i >= 0; i--) {
    if (i in array) accumulator = callback(accumulator, array[i], i, array);
  }
  return accumulator;
}

function every(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.every requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.every callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (i in array && !callback.@call(thisArg, array[i], i, array)) return false;
  }
  return true;
}

function forEach(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.forEach requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.forEach callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (i in array) callback.@call(thisArg, array[i], i, array);
  }
}

// @alwaysInline
function filter(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.filter requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.filter callback must be a function");
  var thisArg = @argument(1);
  var result = @newArrayWithSpecies(0, array);
  var resultLength = 0;
  for (var i = 0; i < length; i++) {
    if (!(i in array)) continue;
    var element = array[i];
    if (callback.@call(thisArg, element, i, array)) @putByValDirect(result, resultLength++, element);
  }
  return result;
}

function map(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.map requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.map callback must be a function");
  var thisArg = @argument(1);
  var result = @newArrayWithSpecies(length, array);
  for (var i = 0; i < length; i++) {
    if (i in array) @putByValDirect(result, i, callback.@call(thisArg, array[i], i, array));
  }
  return result;
}

function some(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.some requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.some callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (i in array && callback.@call(thisArg, array[i], i, array)) return true;
  }
  return false;
}

function find(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.find requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.find callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    var element = array[i];
    if (callback.@call(thisArg, element, i, array)) return element;
  }
}

function findLast(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.findLast requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.findLast callback must be a function");
  var thisArg = @argument(1);
  for (var i = length - 1; i >= 0; i--) {
    var element = array[i];
    if (callback.@call(thisArg, element, i, array)) return element;
  }
}

function findIndex(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.findIndex requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.findIndex callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (callback.@call(thisArg, array[i], i, array)) return i;
  }
  return -1;
}

function findLastIndex(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.findLastIndex requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.findLastIndex callback must be a function");
  var thisArg = @argument(1);
  for (var i = length - 1; i >= 0; i--) {
    if (callback.@call(thisArg, array[i], i, array)) return i;
  }
  return -1;
}

// FlattenIntoArray with a depth of zero.
// @private
function flatIntoArray(target, source, targetIndex) {
  var length = @toLength(source.length);
  for (var i = 0; i < length; i++) {
    if (!(i in source)) continue;
    var element = source[i];
    if (targetIndex >= @MAX_SAFE_INTEGER) @throwTypeError("flatten array exceeds 2**53 - 1");
    @putByValDirect(target, targetIndex++, element);
  }
  return targetIndex;
}

function flatMap(callback /*, thisArg */) {
  var array = @toObject(this, "Array.prototype.flatMap requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  if (!@isCallable(callback)) @throwTypeError("Array.prototype.flatMap callback must be a function");
  var thisArg = @argument(1);
  var result = @newArrayWithSpecies(0, array);
  var resultLength = 0;
  for (var i = 0; i < length; i++) {
    if (!(i in array)) continue;
    var element = callback.@call(thisArg, array[i], i, array);
    if (@isArray(element)) resultLength = @flatIntoArray(result, element, resultLength);
    else {
      if (resultLength >= @MAX_SAFE_INTEGER) @throwTypeError("flatten array exceeds 2**53 - 1");
      @putByValDirect(result, resultLength++, element);
    }
  }
  return result;
}

function at(index) {
  var array = @toObject(this, "Array.prototype.at requires that |this| not be null or undefined");
  var length = @toLength(array.length);
  var i = @toIntegerOrInfinity(index);
  if (i < 0) i += length;
  return i >= 0 && i < length ? array[i] : @undefined;
}
