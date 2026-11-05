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
declare function $isCollectionIteratorClosedMark(value: unknown): boolean;

$visibility = "Private";
export function toArray(this: unknown): unknown[] {
  if (!$isObject(this)) $throwTypeError("Iterator.prototype.toArray requires that |this| be an Object.");
  const next: unknown = (this as any).next;
  const items: unknown[] = [];
  for (;;) {
    if (!$isCallable(next)) $throwTypeError("Type error");
    const value = stepIterator(this, next);
    if ($isCollectionIteratorClosedMark(value)) return items;
    $arrayPush(items, value);
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
    const value = stepIterator(this, next);
    if ($isCollectionIteratorClosedMark(value)) return;
    $ifAbruptCloseIterator(this, $call(procedure, undefined, value, counter++));
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
  if (typeof items !== "string") {
    const copied = $arrayFromFastWithoutMapFn(this, items);
    if (copied) return copied;
  }
  const result: unknown[] = [];
  for (const value of items) $arrayPush(result, value);
  return result;
}

// `[...items]`, `f(...items)` of an object of the program's own. The run time would list nothing of it in one piece: it would call `next` from native code, entering compiled code anew for each step.
// `target` is the list that the spread fills, which no code of the program has seen. `items` is neither undefined nor null.
// It does what performIteration() of the engine does, in that order and in those words: a spread takes whatever the method under @@iterator answers, and asks a number for `next` as it asks an object.
$visibility = "Private";
export function appendIterable(target: unknown[], items: unknown): void {
  const method: unknown = (items as any).$$iterator;
  if (!$isCallable(method)) $throwTypeError("Spread syntax requires ...iterable[Symbol.iterator] to be a function");
  const iterator: unknown = $call(method, items);
  // In the words of the run time, which quotes no text of the program.
  if (iterator === undefined) $throwTypeError("undefined is not an object");
  if (iterator === null) $throwTypeError("null is not an object");
  const next: unknown = (iterator as any).next;
  // As `next` of a generator does it, which asks by itself whether it was given one. Nobody sees the object that a call of it would answer with.
  if (next === $generatorProtoNext) {
    for (;;) {
      const step = $stepGenerator(iterator, $resumeModeNext, undefined, $generatorStepCheckIsGenerator);
      const value = $resultAt(step, $stepGeneratorResultValue);
      const status = $resultAt(step, $stepGeneratorResultStatus);
      // It is running, has ended, or is no generator: the method answers.
      if (status === $generatorStepStatusNotStepped) break;
      if (status === $generatorStepStatusCompleted) return;
      $arrayPush(target, value);
    }
  }
  for (;;) {
    const item: unknown = $call(next, iterator);
    if (!$isObject(item)) $throwTypeError("Iterator result interface is not an object");
    if ((item as any).done) return;
    $arrayPush(target, (item as any).value);
  }
}

// `const [a, b] = items` of an object of the program's own. The run time would call `next` and `return` from native code, entering compiled code anew for each.
// It does what the language says of a pattern of `count` places, in that order: it steps that often, and closes what is not done. `count` is not 0. No code of the program sees the list that it hands back.
// THREE ERRORS QUOTE THE PATTERN, and a function of the library has no pattern to quote: so it throws none of them. It hands back a list that begins with the mark of a closed iterator, which no program ever holds,
// and the run time throws from where the pattern stands: the mark alone: there is no method to call . the mark and a value: `next` or `return`, which is no function.
$visibility = "Private";
export function takeFromIterable(items: unknown, count: number): unknown[] {
  const iterator: unknown = openIterator(items);
  if (iterator === undefined) return [$collectionIteratorClosedMark()];
  const next: unknown = (iterator as any).next;
  if (!$isCallable(next)) return [$collectionIteratorClosedMark(), next];
  const taken: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const value: unknown = stepIterator(iterator, next);
    if ($isCollectionIteratorClosedMark(value)) return taken;
    $arrayPush(taken, value);
  }
  const close: unknown = (iterator as any).return;
  if (close === undefined || close === null) return taken;
  if (!$isCallable(close)) return [$collectionIteratorClosedMark(), close];
  if (!$isObject($call(close, iterator))) $throwTypeError("Iterator result interface is not an object.");
  return taken;
}

// `[...gen()]`, `f(...gen())`, where the engine knows that `items` is a generator and has seen that it is as it was made.
// What is written of the parameter lets the loop ask once, where it opens, and step the body itself.
$visibility = "Private";
export function appendGenerator(target: unknown[], items: Generator<unknown>): void {
  for (const value of items) $arrayPush(target, value);
}

declare function $isArrayIterator(value: unknown): boolean;
declare function $isMapIterator(value: unknown): boolean;
declare function $isSetIterator(value: unknown): boolean;
declare function $stepArrayIterator(iterator: unknown): unknown;
declare function $stepMapIterator(iterator: unknown): unknown;
declare function $stepSetIterator(iterator: unknown): unknown;
declare function $stepGenerator(generator: unknown, mode: number, value: unknown, check: number): unknown;
declare function $resumeGenerator(generator: unknown, mode: number, value: unknown): any;
declare function $resultAt(results: unknown, index: number): unknown;
declare function $collectionIteratorClosedMark(): unknown;
declare function $asyncFromSyncIteratorCreate(iterator: object): object;
declare const $arrayIteratorProtoNext: unknown;
declare const $mapIteratorProtoNext: unknown;
declare const $setIteratorProtoNext: unknown;
declare const $generatorProtoNext: unknown;
declare const $stepArrayIteratorResultDone: number;
declare const $stepArrayIteratorResultValue: number;
declare const $stepGeneratorResultValue: number;
declare const $stepGeneratorResultStatus: number;
declare const $generatorStepCheckIsGenerator: number;
declare const $generatorStepStatusCompleted: number;
declare const $generatorStepStatusNotStepped: number;
declare const $resumeModeNext: number;

// `for (const value of items)`, `[a, b] = items`, where the engine knows nothing of `items`: it calls the five functions below in place of writing the protocol out at every loop.
// No parameter has a type, so that none is tested: anything arrives. Each does what the language says in the order in which the language says it, and nothing else that a getter or a Proxy would see.

// A TEXT. Nobody gets hold of the iterator that a loop or a pattern opens, and a text never changes. So where the method under @@iterator is the engine's own, openIterator() makes no iterator of the engine,
// whose `next` is native code and answers with an object for each character: it makes what stands for one. That goes by the protocol as any iterator does, for whoever calls its `next`.
// And no program ever holds that function: so whatever has it under `next` is what openIterator() has made, and stepIterator() steps it without a call and without an object.
declare const $stringProtoSymbolIterator: unknown;
declare const $nextOfStepsOverText: unknown;
// The text and the place in it lie under names that no program spells and no object of the host has: a read of them off a value that nobody knows finds nothing else.
interface StepsOverText {
  $text: string;
  $start: number;
  next: unknown;
}

// One code point: two code units where a trail surrogate stands behind a lead surrogate, else one. The mark of a closed iterator behind the last.
function stepOverText(steps: StepsOverText): unknown {
  const text: unknown = steps.$text;
  const at: unknown = steps.$start;
  // Both hold, by what openIterator() lays down. They are asked so that what follows is compiled for a text and a whole number: what is written of a type proves nothing.
  if (typeof text !== "string" || typeof at !== "number") return $collectionIteratorClosedMark();
  const position = at | 0;
  const length = text.length;
  if (position >= length) return $collectionIteratorClosedMark();
  const first = text.charCodeAt(position);
  if (first >= 0xd800 && first <= 0xdbff && position + 1 < length) {
    const second = text.charCodeAt(position + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      steps.$start = position + 2;
      return text.substring(position, position + 2);
    }
  }
  steps.$start = position + 1;
  return text[position];
}

$visibility = "Private";
export function nextOfStepsOverText(this: StepsOverText): unknown {
  const piece: unknown = stepOverText(this);
  return $isCollectionIteratorClosedMark(piece) ? { value: undefined, done: true } : { value: piece, done: false };
}

// `iterable` is neither undefined nor null. Undefined: it has no method to call, and the loop throws what tells of that.
$visibility = "Private";
export function openIterator(iterable: unknown): unknown {
  const method: unknown = (iterable as any).$$iterator;
  if (!$isCallable(method)) return undefined;
  if (typeof iterable === "string" && method === $stringProtoSymbolIterator)
    return { $text: iterable, $start: 0, next: $nextOfStepsOverText };
  const iterator: unknown = $call(method, iterable);
  if (!$isObject(iterator)) $throwTypeError("Iterator result interface is not an object.");
  return iterator;
}

// `for await (const value of items)`, where `items` has nothing under Symbol.asyncIterator.
$visibility = "Private";
export function openWrappedIterator(iterable: unknown): unknown {
  const method: unknown = (iterable as any).$$iterator;
  if (!$isCallable(method)) $throwTypeError("iterable should have an iterator symbol");
  const iterator: unknown = $call(method, iterable);
  if (!$isObject(iterator)) $throwTypeError("iterator method should return an object");
  return $asyncFromSyncIteratorCreate(iterator);
}

// What the iterator hands out. Where it is done: the mark of a closed iterator, which no program ever holds, so that no value can be mistaken for it.
// `next` is what the loop read off the iterator when it opened it. Where that is the own method of an iterator of the engine, nobody sees the object that a call of it answers with, and none is made.
$visibility = "Private";
export function stepIterator(iterator: unknown, next: unknown): unknown {
  // The kind of the cell is one byte, and `next` is compared where the kind fits: whatever is of none of the three kinds comes to the end behind three looks at that byte and two comparisons.
  if ($isArrayIterator(iterator)) {
    if (next === $arrayIteratorProtoNext) {
      const step = $stepArrayIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if ($isMapIterator(iterator)) {
    if (next === $mapIteratorProtoNext) {
      const step = $stepMapIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if ($isSetIterator(iterator)) {
    if (next === $setIteratorProtoNext) {
      const step = $stepSetIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if (next === $generatorProtoNext) {
    // As `next` of a generator does it, which asks by itself whether it was given one.
    const step = $stepGenerator(iterator, $resumeModeNext, undefined, $generatorStepCheckIsGenerator);
    const value = $resultAt(step, $stepGeneratorResultValue);
    const status = $resultAt(step, $stepGeneratorResultStatus);
    if (status === $generatorStepStatusNotStepped) {
      const answer = $resumeGenerator(iterator, $resumeModeNext, undefined);
      return answer.done === true ? $collectionIteratorClosedMark() : answer.value;
    }
    return status === $generatorStepStatusCompleted ? $collectionIteratorClosedMark() : value;
  } else if (next === $nextOfStepsOverText) return stepOverText(iterator as StepsOverText);
  const result = $iteratorGenericNext(next, iterator);
  return result.done ? $collectionIteratorClosedMark() : result.value;
}

// WHICH WAY AN ITERATOR IS STEPPED IS SETTLED WHERE THE LOOP OPENS IT: `next` is read once, there, and the kind of a cell never changes. So a loop asks once and hands the answer to each step.
// 0: the loop calls `next` itself. Else `next` is the own method of an iterator of the engine, of a generator, or of what openIterator() has made of a text, as in stepIterator().
$visibility = "Private";
export function wayToStepIterator(iterator: unknown, next: unknown): number {
  if ($isArrayIterator(iterator)) return next === $arrayIteratorProtoNext ? 1 : 0;
  if ($isMapIterator(iterator)) return next === $mapIteratorProtoNext ? 2 : 0;
  if ($isSetIterator(iterator)) return next === $setIteratorProtoNext ? 3 : 0;
  if (next === $generatorProtoNext) return 4;
  return next === $nextOfStepsOverText ? 5 : 0;
}

// What the iterator hands out, or the mark of a closed iterator. `way` is what wayToStepIterator() has said of this iterator, and not 0.
// The kind of the cell holds by that. It is asked so that what follows is compiled for that kind: what is written of a type proves nothing.
$visibility = "Private";
export function stepIteratorInWay(iterator: unknown, way: unknown): unknown {
  if (way === 3) {
    if ($isSetIterator(iterator)) {
      const step = $stepSetIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if (way === 2) {
    if ($isMapIterator(iterator)) {
      const step = $stepMapIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if (way === 5) return stepOverText(iterator as StepsOverText);
  else if (way === 1) {
    if ($isArrayIterator(iterator)) {
      const step = $stepArrayIterator(iterator);
      const value = $resultAt(step, $stepArrayIteratorResultValue);
      return $resultAt(step, $stepArrayIteratorResultDone) ? $collectionIteratorClosedMark() : value;
    }
  } else if (way === 4) {
    const step = $stepGenerator(iterator, $resumeModeNext, undefined, $generatorStepCheckIsGenerator);
    const value = $resultAt(step, $stepGeneratorResultValue);
    const status = $resultAt(step, $stepGeneratorResultStatus);
    if (status === $generatorStepStatusNotStepped) {
      const answer = $resumeGenerator(iterator, $resumeModeNext, undefined);
      return answer.done === true ? $collectionIteratorClosedMark() : answer.value;
    }
    return status === $generatorStepStatusCompleted ? $collectionIteratorClosedMark() : value;
  }
  return $collectionIteratorClosedMark();
}

$visibility = "Private";
export function closeIterator(iterator: unknown): void {
  $iteratorGenericClose(iterator as any);
}

// The error that is already being thrown wins: whatever reading `return` or calling it throws is dropped.
// Undefined: the loop has opened no iterator: it reads what it iterates over by index, and its handler asks nobody which way the open went.
$visibility = "Private";
export function closeIteratorAfterThrow(iterator: unknown): void {
  if (iterator === undefined) return;
  try {
    $iteratorGenericClose(iterator as any);
  } catch {}
}
