export function forEach(callback /*, thisArg */) {
    "use strict";

    if (!$isMap(this))
        throw new TypeError("Map operation called on non-Map object");

    if (!$isCallable(callback))
        throw new TypeError("Map.prototype.forEach callback must be a function");

    const thisArg = $argument(1);
    let table = $collectionTable(this);
    let entry = 0;
    for (;;) {
        entry = $mapNext(this, table, entry);
        if (entry < 0)
            return;
        table = $collectionTable(this);
        callback.$call(thisArg, $mapValueAt(this, entry), $mapKeyAt(this, entry), this);
        entry++;
    }
}
