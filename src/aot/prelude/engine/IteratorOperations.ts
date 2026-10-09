// BytecodeGenerator::emitIteratorGenericNext() and emitIteratorGenericClose().

$linkTimeConstant;
$alwaysInline;
export function iteratorGenericNext(nextMethod, iterator) {
    "use strict";

    var result = nextMethod.$call(iterator);
    if (!$isObject(result))
        throw new TypeError("Iterator result interface is not an object.");
    return result;
}

$linkTimeConstant;
$alwaysInline;
export function iteratorGenericClose(iterator) {
    "use strict";

    var returnMethod = iterator.return;
    if ($isUndefinedOrNull(returnMethod))
        return;
    if (!$isObject(returnMethod.$call(iterator)))
        throw new TypeError("Iterator result interface is not an object.");
}
