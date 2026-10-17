export function forEach(callback /*, thisArg */) {
  "use strict";

  if (!$isSet(this)) throw new TypeError("Set operation called on non-Set object");

  if (!$isCallable(callback)) throw new TypeError("Set.prototype.forEach callback must be a function");

  const thisArg = $argument(1);
  let table = $collectionTable(this);
  let entry = 0;
  for (;;) {
    entry = $setNext(this, table, entry);
    if (entry < 0) return;
    table = $collectionTable(this);
    const key = $setKeyAt(this, entry);
    callback.$call(thisArg, key, key, this);
    entry++;
  }
}
