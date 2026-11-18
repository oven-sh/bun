function every(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.every callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (!callback.@call(thisArg, this[i], i, this)) return false;
  }
  return true;
}

function some(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.some callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (callback.@call(thisArg, this[i], i, this)) return true;
  }
  return false;
}

function forEach(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.forEach callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) callback.@call(thisArg, this[i], i, this);
}

function map(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.map callback must be a function");
  var thisArg = @argument(1);
  var result = @typedArraySpeciesCreate(this, length);
  for (var i = 0; i < length; i++) result[i] = callback.@call(thisArg, this[i], i, this);
  return result;
}

function filter(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.filter callback must be a function");
  var thisArg = @argument(1);
  var kept = [];
  var count = 0;
  for (var i = 0; i < length; i++) {
    var value = this[i];
    if (callback.@call(thisArg, value, i, this)) @putByValDirect(kept, count++, value);
  }
  return @typedArraySpeciesCreate(this, count, kept);
}

function find(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.find callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    var value = this[i];
    if (callback.@call(thisArg, value, i, this)) return value;
  }
  return @undefined;
}

function findIndex(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.findIndex callback must be a function");
  var thisArg = @argument(1);
  for (var i = 0; i < length; i++) {
    if (callback.@call(thisArg, this[i], i, this)) return i;
  }
  return -1;
}

function findLast(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.findLast callback must be a function");
  var thisArg = @argument(1);
  for (var i = length - 1; i >= 0; i--) {
    var value = this[i];
    if (callback.@call(thisArg, value, i, this)) return value;
  }
  return @undefined;
}

function findLastIndex(callback /*, thisArg */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.findLastIndex callback must be a function");
  var thisArg = @argument(1);
  for (var i = length - 1; i >= 0; i--) {
    if (callback.@call(thisArg, this[i], i, this)) return i;
  }
  return -1;
}

function reduce(callback /*, initialValue */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.reduce callback must be a function");
  var accumulator;
  var i = 0;
  if (@argumentCount() > 1) accumulator = @argument(1);
  else if (length === 0) @throwTypeError("TypedArray.prototype.reduce of empty array with no initial value");
  else accumulator = this[i++];
  for (; i < length; i++) accumulator = callback(accumulator, this[i], i, this);
  return accumulator;
}

function reduceRight(callback /*, initialValue */) {
  if (!@isObject(this)) @throwTypeError("Receiver should be a typed array view but was not an object");
  var length = @typedArrayLength(this);
  if (!@isCallable(callback)) @throwTypeError("TypedArray.prototype.reduceRight callback must be a function");
  var accumulator;
  var i = length - 1;
  if (@argumentCount() > 1) accumulator = @argument(1);
  else if (length === 0) @throwTypeError("TypedArray.prototype.reduceRight of empty array with no initial value");
  else accumulator = this[i--];
  for (; i >= 0; i--) accumulator = callback(accumulator, this[i], i, this);
  return accumulator;
}

function toLocaleString(/* locales, options */) {
  var length = @typedArrayLength(this);
  var result = "";
  for (var i = 0; i < length; i++) {
    if (i > 0) result += ",";
    var element = this[i];
    if (!@isUndefinedOrNull(element)) result += @toString(element.toLocaleString(@argument(0), @argument(1)));
  }
  return result;
}
