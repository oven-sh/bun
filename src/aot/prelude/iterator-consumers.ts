// These functions stand for native code of the engine. A stack trace names none of them.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isObject(value: unknown): value is object;
declare function $isCallable(value: unknown): boolean;
declare function $throwTypeError(message: string): never;
declare function $isConstructor(value: unknown): boolean;
declare function $putByValDirect(array: unknown, index: number, value: unknown): void;
declare function $arrayPush(array: unknown[], value: unknown): void;
declare function $iteratorGenericClose(iterator: object): void;
declare function $iteratorGenericNext(next: unknown, iterator: unknown): any;
declare function $ifAbruptCloseIterator(iterator: object, value: unknown): void;

$visibility = "Private";
export function toArray(this: unknown): unknown[] {
  if (!$isObject(this)) $throwTypeError("Iterator.prototype.toArray requires that |this| be an Object.");
  const next: unknown = (this as any).next;
  const items: unknown[] = [];
  for (;;) {
    if (!$isCallable(next)) $throwTypeError("Type error");
    const result = $iteratorGenericNext(next, this);
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
    const result = $iteratorGenericNext(next, this);
    if ((result as any).done) return;
    $ifAbruptCloseIterator(this, $call(procedure, undefined, (result as any).value, counter++));
  }
}

$visibility = "Public";
export function from(this: any, items: Iterable<unknown>, mapper: any, thisArg?: unknown): unknown {
  const result = this !== Array && $isConstructor(this) ? new this() : [];
  if (!$isObject(result)) $throwTypeError("Array.from requires that |this| constructs an object");
  let k = 0;
  for (const value of items) {
    $putByValDirect(result, k, thisArg === undefined ? mapper(value, k) : $call(mapper, thisArg, value, k));
    k += 1;
  }
  (result as any).length = k;
  return result;
}

declare function $arrayFromFastWithoutMapFn(constructor: unknown, items: unknown): unknown[] | undefined;

// `Array.from(map)`, `Array.from(map.entries())`: what native code does not copy at once is walked by a loop, which asks no `next` for an object a step.
$visibility = "Public";
export function fromIterable(this: unknown, items: Iterable<unknown>): unknown[] {
  if (typeof items === "string") return [...items];
  const copied = $arrayFromFastWithoutMapFn(this, items);
  if (copied) return copied;
  if ((items as any).next === undefined) return [...items];
  const result: unknown[] = [];
  for (const value of items) $arrayPush(result, value);
  return result;
}
