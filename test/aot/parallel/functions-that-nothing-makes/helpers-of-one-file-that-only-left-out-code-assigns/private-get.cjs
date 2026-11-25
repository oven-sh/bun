// A private field helper of this file that only a function that nobody calls would assign hands a descriptor to another helper. Calls of it build and throw as in bun run.
var _get;
function _classExtractFieldDescriptor(receiver, privateMap, action) {
  if (!privateMap.has(receiver)) {
    throw new TypeError("attempted to " + action + " private field on non-instance");
  }
  return privateMap.get(receiver);
}
function _classApplyDescriptorGet(receiver, descriptor) {
  if (descriptor.get) {
    return descriptor.get.call(receiver);
  }
  return descriptor.value;
}
function init() { _get = function(receiver, privateMap) {
  var descriptor = _classExtractFieldDescriptor(receiver, privateMap, "get");
  return _classApplyDescriptorGet(receiver, descriptor);
}; }
var _size = new WeakMap();
class Box { constructor(size) { _size.set(this, { writable: true, value: size }); } get size() { return _get(this, _size); } }
try { console.log(new Box(2).size); } catch (e) { console.log(e.name, typeof _get); }
