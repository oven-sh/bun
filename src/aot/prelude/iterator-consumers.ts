// These functions stand for native code of the engine. A stack trace names none of them.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isObject(value: unknown): value is object;
declare function $isCallable(value: unknown): boolean;
declare function $throwTypeError(message: string): never;
declare function $arrayPush(array: unknown[], value: unknown): void;
declare function $iteratorGenericClose(iterator: object): void;
declare function $ifAbruptCloseIterator(iterator: object, value: unknown): void;

$visibility = "Private";
export function toArray(this: unknown): unknown[] {
  if (!$isObject(this)) $throwTypeError("Iterator.prototype.toArray requires that |this| be an Object.");
  const next: unknown = (this as any).next;
  const items: unknown[] = [];
  for (;;) {
    if (!$isCallable(next)) $throwTypeError("Type error");
    const result = $call<any>(next, this);
    if (!$isObject(result)) $throwTypeError("Iterator result interface is not an object.");
    if ((result as any).done) return items;
    $arrayPush(items, (result as any).value);
  }
}

$visibility = "Private";
export function forEach(this: unknown, procedure: unknown): void {
  if (!$isObject(this)) $throwTypeError("Iterator.prototype.forEach requires that |this| be an Object.");
  if (!$isCallable(procedure)) {
    try {
      $iteratorGenericClose(this);
    } catch {}
    $throwTypeError("Iterator.prototype.forEach requires the callback argument to be callable.");
  }
  const next: unknown = (this as any).next;
  let counter = 0;
  for (;;) {
    if (!$isCallable(next)) $throwTypeError("Type error");
    const result = $call<any>(next, this);
    if (!$isObject(result)) $throwTypeError("Iterator result interface is not an object.");
    if ((result as any).done) return;
    $ifAbruptCloseIterator(this, $call(procedure, undefined, (result as any).value, counter++));
  }
}
