declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $callNoInline<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare var $overriddenName: string;
declare function $typedArrayLength(view: unknown): number;
declare function $isTypedArrayOutOfBounds(view: unknown): boolean;
declare function $throwTypeError(message: string): never;
declare function $arrayStorageKind(a: unknown[]): number;
declare const $arrayStorageInt32: number;
declare const $arrayStorageDouble: number;
declare const $arrayStorageContiguous: number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;
// For the arrays that this file made and filled up to `count`: every position that is asked lies below it. The comparator never sees them.
declare function $getOwnContiguousIndex<T>(a: unknown[], k: number): T;
declare function $putOwnContiguousIndex(a: unknown[], k: number, value: unknown): void;
declare function $getOwnDoubleIndex(a: unknown[], k: number): number;
declare function $getOwnInt32Index(a: unknown[], k: number): number;
declare function $putOwnDoubleIndex(a: unknown[], k: number, value: number): void;
declare function $putOwnInt32Index(a: unknown[], k: number, value: number): void;
declare function $truncateNewArray<T>(out: T[], n: number): T[];
declare function $newContiguousArray<T>(n: number): T[];
declare function $newArrayLike<T>(n: number, a: unknown[] | undefined): T[];
declare function $putContiguousIndex(out: unknown[], k: number, value: unknown): void;
declare function $tryPutIndex(a: unknown[], k: number, value: unknown): boolean;
// The first `count` values of `from` into an array that this file made for them, numbers boxed. False where `from` has a hole or undefined among them, or storage of another kind.
declare function $tryCopyFilledElements(out: unknown[], from: unknown[], count: number): boolean;
// Sorts a list of numbers by value, downward where `direction` is negative. False, with nothing stored, where the list holds anything else, NaN or -0. The list is writable.
declare function $sortNumbers(a: unknown[], direction: number): boolean;
// The first `count` values of an array that this file made into one that the program holds. False, with nothing stored, where that one has no writable storage for them.
declare function $tryPutElements(a: unknown[], from: unknown[], count: number): boolean;

// The comparator sees the same calls in the same order as in arrayStableSort of JavaScriptCore's runtime/StableSort.h.

function isCallable(value: unknown): boolean {
  return typeof value === "function";
}

function isDoubleArray(array: unknown[]): boolean {
  return $arrayStorageKind(array) === $arrayStorageDouble;
}

function isContiguousArray(array: unknown[]): boolean {
  const kind = $arrayStorageKind(array);
  return kind === $arrayStorageContiguous || kind === $arrayStorageInt32;
}

function isLessThoughNoNumber(comparatorResult: unknown): boolean {
  if (typeof comparatorResult === "boolean") return !comparatorResult;
  return +(comparatorResult as any) < 0;
}

function isLess(comparatorResult: unknown): boolean {
  if (typeof comparatorResult === "number") return comparatorResult < 0;
  return $callNoInline<boolean>(isLessThoughNoNumber, undefined, comparatorResult);
}

function gallopLeft(
  key: unknown,
  from: unknown[],
  base: number,
  length: number,
  hint: number,
  comparator: unknown,
): number {
  let lastOffset = 0;
  let offset = 1;
  const atHint: unknown = $getOwnContiguousIndex<unknown>(from, base + hint);
  if (isLess($callNoInline<unknown>(comparator, undefined, atHint, key))) {
    const maxOffset = (length - hint) | 0;
    while (offset < maxOffset) {
      const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + hint + offset);
      if (!isLess($callNoInline<unknown>(comparator, undefined, probe, key))) break;
      lastOffset = offset;
      offset = (offset * 2 + 1) | 0;
      if (offset > maxOffset) offset = maxOffset;
    }
    lastOffset = (lastOffset + hint) | 0;
    offset = (offset + hint) | 0;
  } else {
    const maxOffset = (hint + 1) | 0;
    while (offset < maxOffset) {
      const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + hint - offset);
      if (isLess($callNoInline<unknown>(comparator, undefined, probe, key))) break;
      lastOffset = offset;
      offset = (offset * 2 + 1) | 0;
      if (offset > maxOffset) offset = maxOffset;
    }
    const previous = lastOffset;
    lastOffset = (hint - offset) | 0;
    offset = (hint - previous) | 0;
  }
  lastOffset = (lastOffset + 1) | 0;
  while (lastOffset < offset) {
    const middle = (lastOffset + ((offset - lastOffset) >> 1)) | 0;
    const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + middle);
    if (isLess($callNoInline<unknown>(comparator, undefined, probe, key))) lastOffset = (middle + 1) | 0;
    else offset = middle;
  }
  return offset;
}

function gallopRight(
  key: unknown,
  from: unknown[],
  base: number,
  length: number,
  hint: number,
  comparator: unknown,
): number {
  let lastOffset = 0;
  let offset = 1;
  const atHint: unknown = $getOwnContiguousIndex<unknown>(from, base + hint);
  if (!isLess($callNoInline<unknown>(comparator, undefined, key, atHint))) {
    const maxOffset = (length - hint) | 0;
    while (offset < maxOffset) {
      const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + hint + offset);
      if (isLess($callNoInline<unknown>(comparator, undefined, key, probe))) break;
      lastOffset = offset;
      offset = (offset * 2 + 1) | 0;
      if (offset > maxOffset) offset = maxOffset;
    }
    lastOffset = (lastOffset + hint) | 0;
    offset = (offset + hint) | 0;
  } else {
    const maxOffset = (hint + 1) | 0;
    while (offset < maxOffset) {
      const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + hint - offset);
      if (!isLess($callNoInline<unknown>(comparator, undefined, key, probe))) break;
      lastOffset = offset;
      offset = (offset * 2 + 1) | 0;
      if (offset > maxOffset) offset = maxOffset;
    }
    const previous = lastOffset;
    lastOffset = (hint - offset) | 0;
    offset = (hint - previous) | 0;
  }
  lastOffset = (lastOffset + 1) | 0;
  while (lastOffset < offset) {
    const middle = (lastOffset + ((offset - lastOffset) >> 1)) | 0;
    const probe: unknown = $getOwnContiguousIndex<unknown>(from, base + middle);
    if (!isLess($callNoInline<unknown>(comparator, undefined, key, probe))) lastOffset = (middle + 1) | 0;
    else offset = middle;
  }
  return offset;
}

function computeRunPower(previousBegin: number, begin: number, end: number, count: number): number {
  let previousMidpoint = previousBegin + begin;
  let midpoint = begin + end + 1;
  let power = 0;
  while (previousMidpoint >= count === midpoint >= count) {
    if (previousMidpoint >= count) {
      previousMidpoint -= count;
      midpoint -= count;
    }
    previousMidpoint *= 2;
    midpoint *= 2;
    power = (power + 1) | 0;
  }
  return power;
}

function extendValueRun<T>(from: T[], end: number, count: number, comparator: unknown): number {
  for (end = end | 0, count = count | 0; ((end + 1) | 0) < count; end = (end + 1) | 0) {
    const next: T = $getOwnContiguousIndex<T>(from, (end + 1) | 0);
    const last: T = $getOwnContiguousIndex<T>(from, end);
    if (isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  return end;
}

function reverseValues<T>(from: T[], low: number, high: number): void {
  for (; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
    const swapped: T = $getOwnContiguousIndex<T>(from, low);
    $putOwnContiguousIndex(from, low, $getOwnContiguousIndex<T>(from, high));
    $putOwnContiguousIndex(from, high, swapped);
  }
}

// Makes a run that begins at `begin` and answers where it ends. A list of up to 64 values is one run.
// For sortValues() and for the runs behind the first: the first run of sort() is made by insertValues(), which is copied with the comparator.
function findValueRun<T>(from: T[], begin: number, count: number, comparator: unknown): number {
  const extendRunCutoff = 8;
  const forceRunLength = 64;
  begin = begin | 0;
  count = count | 0;
  let end = begin;
  // A list shorter than that is sorted by insertion from its first value on.
  if (count >= extendRunCutoff) {
    let isFalling = false;
    for (; ((end + 1) | 0) < count; end = (end + 1) | 0) {
      const next: T = $getOwnContiguousIndex<T>(from, (end + 1) | 0);
      const last: T = $getOwnContiguousIndex<T>(from, end);
      const isNextLess = isLess($callNoInline<unknown>(comparator, undefined, next, last));
      if (end === begin) isFalling = isNextLess;
      else if (isNextLess !== isFalling) break;
    }
    if (isFalling) reverseValues<T>(from, begin, end);
    if (((end - begin) | 0) >= extendRunCutoff) return extendValueRun<T>(from, end, count, comparator);
  }
  const limit = ((count - begin) | 0) < forceRunLength ? count : (begin + forceRunLength) | 0;
  for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
    const inserted: T = $getOwnContiguousIndex<T>(from, i);
    let left = begin;
    let right = i;
    while (left < right) {
      const middle = (left + ((right - left) >> 1)) | 0;
      const probe: T = $getOwnContiguousIndex<T>(from, middle);
      if (isLess($call<unknown>(comparator, undefined, inserted, probe))) right = middle;
      else left = (middle + 1) | 0;
    }
    let j = i;
    for (; j - 1 > left; j = (j - 2) | 0) {
      const above: T = $getOwnContiguousIndex<T>(from, j - 1);
      const below: T = $getOwnContiguousIndex<T>(from, j - 2);
      $putOwnContiguousIndex(from, j, above);
      $putOwnContiguousIndex(from, j - 1, below);
    }
    if (j > left) $putOwnContiguousIndex(from, j, $getOwnContiguousIndex<T>(from, j - 1));
    $putOwnContiguousIndex(from, left, inserted);
  }
  if (limit >= count) return (limit - 1) | 0;
  return extendValueRun<T>(from, limit - 1, count, comparator);
}

function mergeValueRuns<T>(from: T[], to: T[], low: number, middle: number, end: number, comparator: unknown): void {
  const minGallopThreshold = 7;
  let left = (low + gallopRight($getOwnContiguousIndex<T>(from, middle), from, low, middle - low, 0, comparator)) | 0;
  if (left >= middle) return;
  const high =
    (middle +
      gallopLeft(
        $getOwnContiguousIndex<T>(from, middle - 1),
        from,
        middle,
        end + 1 - middle,
        end - middle,
        comparator,
      )) |
    0;
  if (high <= middle) return;
  const minGallopIndex = (to.length - 1) | 0;
  let minGallop = $getOwnContiguousIndex<number>(to, minGallopIndex) | 0;
  const first = left;
  let right = middle;
  let target = left;
  merging: for (;;) {
    let leftWins = 0;
    let rightWins = 0;
    while (leftWins < minGallop && rightWins < minGallop) {
      if (right >= high || left >= middle) break merging;
      const leftValue: T = $getOwnContiguousIndex<T>(from, left);
      const rightValue: T = $getOwnContiguousIndex<T>(from, right);
      if (isLess($call<unknown>(comparator, undefined, rightValue, leftValue))) {
        $putOwnContiguousIndex(to, target, rightValue);
        right = (right + 1) | 0;
        rightWins = (rightWins + 1) | 0;
        leftWins = 0;
      } else {
        $putOwnContiguousIndex(to, target, leftValue);
        left = (left + 1) | 0;
        leftWins = (leftWins + 1) | 0;
        rightWins = 0;
      }
      target = (target + 1) | 0;
    }
    minGallop = (minGallop + 1) | 0;
    do {
      if (minGallop > 1) minGallop = (minGallop - 1) | 0;
      if (left >= middle || right >= high) break merging;
      leftWins = gallopRight($getOwnContiguousIndex<T>(from, right), from, left, middle - left, 0, comparator);
      for (let k = 0; k < leftWins; k = (k + 1) | 0, target = (target + 1) | 0, left = (left + 1) | 0)
        $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, left));
      $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, right));
      target = (target + 1) | 0;
      right = (right + 1) | 0;
      if (left >= middle || right >= high) break merging;
      rightWins = gallopLeft($getOwnContiguousIndex<T>(from, left), from, right, high - right, 0, comparator);
      for (let k = 0; k < rightWins; k = (k + 1) | 0, target = (target + 1) | 0, right = (right + 1) | 0)
        $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, right));
      $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, left));
      target = (target + 1) | 0;
      left = (left + 1) | 0;
      if (left >= middle || right >= high) break merging;
    } while (leftWins >= minGallopThreshold || rightWins >= minGallopThreshold);
    minGallop = (minGallop + 1) | 0;
  }
  $putOwnContiguousIndex(to, minGallopIndex, minGallop);
  for (; left < middle; left = (left + 1) | 0, target = (target + 1) | 0)
    $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, left));
  for (; right < high; right = (right + 1) | 0, target = (target + 1) | 0)
    $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, right));
  for (let k = first; k < high; k = (k + 1) | 0) $putOwnContiguousIndex(from, k, $getOwnContiguousIndex<T>(to, k));
}

// The values of a typed array: the run time merges those without galloping.
function mergeTypedRuns<T>(from: T[], to: T[], low: number, middle: number, end: number, comparator: unknown): void {
  let left = low | 0;
  let right = middle | 0;
  let target = left;
  while (left < middle && right <= end) {
    const leftValue: T = $getOwnContiguousIndex<T>(from, left);
    const rightValue: T = $getOwnContiguousIndex<T>(from, right);
    if (isLess($call<unknown>(comparator, undefined, rightValue, leftValue))) {
      $putOwnContiguousIndex(to, target, rightValue);
      right = (right + 1) | 0;
    } else {
      $putOwnContiguousIndex(to, target, leftValue);
      left = (left + 1) | 0;
    }
    target = (target + 1) | 0;
  }
  // What is left of the upper run already lies where it belongs.
  for (; left < middle; left = (left + 1) | 0, target = (target + 1) | 0)
    $putOwnContiguousIndex(to, target, $getOwnContiguousIndex<T>(from, left));
  for (let k = low | 0; k < target; k = (k + 1) | 0) $putOwnContiguousIndex(from, k, $getOwnContiguousIndex<T>(to, k));
}

function sortValues<T>(from: T[], count: number, comparator: unknown): void {
  const end = findValueRun<T>(from, 0, count, comparator) | 0;
  if (((end + 1) | 0) < count) mergeFurtherRuns<T>(from, count, end, comparator, mergeValueRuns);
}

function mergeFurtherRuns<T>(
  from: T[],
  count: number,
  endOfFirstRun: number,
  comparator: unknown,
  mergeRuns: unknown,
): void {
  const minGallopThreshold = 7;
  const runStackLength = 72;
  let to: T[] = from;
  let depth = 0;
  let previousBegin = 0;
  let previousEnd = endOfFirstRun;
  for (let begin = (endOfFirstRun + 1) | 0; ;) {
    let end = begin;
    let power = -1;
    if (begin < count) {
      end = findValueRun<T>(from, begin, count, comparator);
      power = computeRunPower(previousBegin, begin, end, count);
    }
    while (depth > 0) {
      const powerBelow: number = $getOwnContiguousIndex<number>(to, count + depth * 2 - 1);
      if (powerBelow <= power) break;
      depth = (depth - 1) | 0;
      const low: number = $getOwnContiguousIndex<number>(to, count + depth * 2) | 0;
      $call<void>(mergeRuns, undefined, from, to, low, previousBegin, previousEnd, comparator);
      previousBegin = low;
    }
    if (begin >= count) return;
    if (to === from) {
      // The scratch array holds the merged elements, then the stack of pending runs, then minGallop.
      to = $newContiguousArray<T>(count + runStackLength + 1);
      $putOwnContiguousIndex(to, count + runStackLength, minGallopThreshold);
    }
    $putOwnContiguousIndex(to, count + depth * 2, previousBegin);
    $putOwnContiguousIndex(to, count + depth * 2 + 1, power);
    depth = (depth + 1) | 0;
    previousBegin = begin;
    previousEnd = end;
    begin = (end + 1) | 0;
  }
}

// The first `count` values of an array that this file made, in one with room for twice as many.
function moveToLongerArray<T>(from: T[], count: number): T[] {
  const longer: T[] = $newContiguousArray<T>(count * 2);
  for (let index = 0; index < count; index = (index + 1) | 0)
    $putOwnContiguousIndex(longer, index, $getOwnContiguousIndex<T>(from, index));
  return longer;
}

// From the first store that the program's array refused on, then undefined as often as it was met, then holes.
function putRestOfSortedValues<T>(
  array: T[],
  length: number,
  from: T[],
  count: number,
  index: number,
  undefinedCount: number,
): void {
  for (; index < count; index++) {
    const value = $getContiguousIndex<T>(from, index);
    const isStored: boolean = $tryPutIndex(array, index, value);
    if (!isStored) array[index] = value;
  }
  for (; undefinedCount > 0 && index < length; undefinedCount--, index++) array[index] = undefined as unknown as T;
  for (; index < length; index++) delete array[index];
}

// Puts `count` sorted values back, then undefined as often as it was met, then holes up to `length`.
function putSortedValues<T>(array: T[], length: number, from: T[], count: number, undefinedCount: number): void {
  // Storage for doubles may be younger than the values: no number, and it is false.
  const areStored: boolean = $tryPutElements(array, from, count);
  const index = areStored ? count : 0;
  if (index < length) putRestOfSortedValues<T>(array, length, from, count, index, undefinedCount);
}

// A list with a hole or undefined in it, or with storage of another kind.
function sortListOfAnyKind<T>(array: T[], length: number, comparator: unknown): void {
  let from: T[];
  let count = 0;
  let undefinedCount = 0;
  if (isContiguousArray(array)) {
    from = $newContiguousArray<T>(length);
    for (let index = 0; index < length; index++) {
      const value = $getContiguousIndex<T>(array, index);
      if (value === undefined) {
        // A hole reads as undefined too.
        const has: boolean = $hasContiguousIndex(array, index);
        if (has) undefinedCount++;
        continue;
      }
      $putOwnContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  } else {
    // Storage for numbers is as long as the list. Any other kind need not be, as behind `a[300_000_000] = 1`: the copy grows with what is found.
    let capacity = isDoubleArray(array) ? length : 16;
    from = $newContiguousArray<T>(capacity);
    for (let index = 0; index < length; index++) {
      if (!(index in array)) continue;
      const value = array[index];
      if (value === undefined) {
        undefinedCount++;
        continue;
      }
      if (count === capacity) {
        from = moveToLongerArray<T>(from, count);
        capacity = count * 2;
      }
      $putContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  }
  sortValues<T>(from, count, comparator);
  putSortedValues<T>(array, length, from, count, undefinedCount);
}

// The values of a list that holds neither a hole nor undefined, in an array that the comparator never sees. A number is boxed once here, not for every call.
// Any other list is sorted here, and the answer is undefined.
function takeValuesOrSort<T>(array: T[], comparator: unknown): T[] | undefined {
  if (!isCallable(comparator)) {
    (array as any).sort(comparator);
    return undefined;
  }
  const length = array.length;
  if (length < 2) return undefined;
  if (isContiguousArray(array) || isDoubleArray(array)) {
    const from: T[] = $newContiguousArray<T>(length);
    const isCopied: boolean = $tryCopyFilledElements(from, array, length);
    if (isCopied) return from;
  }
  sortListOfAnyKind<T>(array, length, comparator);
  return undefined;
}

// How many values at the front are in order, of eight values or more. Few comparisons are made here, so they go by value.
function countValuesInOrder<T>(from: T[], comparator: unknown): number {
  const count = from.length | 0;
  let end = 0;
  let isFalling = false;
  for (; ((end + 1) | 0) < count; end = (end + 1) | 0) {
    const next: T = $getOwnContiguousIndex<T>(from, (end + 1) | 0);
    const last: T = $getOwnContiguousIndex<T>(from, end);
    const isNextLess = isLess($callNoInline<unknown>(comparator, undefined, next, last));
    if (end === 0) isFalling = isNextLess;
    else if (isNextLess !== isFalling) break;
  }
  if (isFalling) reverseValues<T>(from, 0, end);
  return (end + 1) | 0;
}

function moveUpAndPut<T>(from: T[], left: number, i: number, inserted: T): void {
  let j = i;
  for (; j - 1 > left; j = (j - 2) | 0) {
    const above: T = $getOwnContiguousIndex<T>(from, j - 1);
    const below: T = $getOwnContiguousIndex<T>(from, j - 2);
    $putOwnContiguousIndex(from, j, above);
    $putOwnContiguousIndex(from, j - 1, below);
  }
  if (j > left) $putOwnContiguousIndex(from, j, $getOwnContiguousIndex<T>(from, j - 1));
  $putOwnContiguousIndex(from, left, inserted);
}

// Small, so that it is copied with its comparator where sort() is copied: most calls of the comparator are made here.
function insertValues<T>(from: T[], inOrder: number, limit: number, comparator: unknown): void {
  for (let i = inOrder | 0; i < limit; i = (i + 1) | 0) {
    const inserted: T = $getOwnContiguousIndex<T>(from, i);
    let left = 0;
    let right = i;
    while (left < right) {
      const middle = (left + right) >>> 1;
      const answer: unknown = $call<unknown>(comparator, undefined, inserted, $getOwnContiguousIndex<T>(from, middle));
      if (typeof answer === "number" ? answer < 0 : $callNoInline<boolean>(isLessThoughNoNumber, undefined, answer))
        right = middle;
      else left = (middle + 1) | 0;
    }
    if (left < i) $callNoInline<void>(moveUpAndPut, undefined, from, left, i, inserted);
  }
}

function mergeRunsAndPutBack<T>(array: T[], from: T[], endOfRun: number, comparator: unknown): void {
  const count = from.length | 0;
  let end = endOfRun | 0;
  if (((end + 1) | 0) < count) end = extendValueRun<T>(from, end, count, comparator);
  if (((end + 1) | 0) < count) mergeFurtherRuns<T>(from, count, end, comparator, mergeValueRuns);
  putSortedValues<T>(array, count, from, count, 0);
}

// Short, so that it is copied into its caller: there the comparator is known, and insertValues() is copied with it.
// No tail calls: a stack trace that the comparator makes has the frame of sort.
export function sort<T>(this: T[], comparator: unknown): T[] {
  const from = takeValuesOrSort<T>(this, comparator);
  if (from === undefined) return this;
  const count = from.length | 0;
  const inOrder = count < 8 ? 1 : $callNoInline<number>(countValuesInOrder, undefined, from, comparator) | 0;
  // A run of more than eight values that were in order is only extended. Else the first run is made by insertion, up to 64 values long.
  const limit = inOrder > 8 ? inOrder : count < 64 ? count : 64;
  insertValues<T>(from, inOrder, limit, comparator);
  $callNoInline<void>(mergeRunsAndPutBack, undefined, this, from, (limit - 1) | 0, comparator);
  return this;
}

// Undefined where NaN is among them: which NaN it is would be lost.
function copyTypedArrayElements(view: any, count: number): number[] | undefined {
  const from: number[] = $newContiguousArray<number>(count);
  for (let index = 0; index < count; index = (index + 1) | 0) {
    const value = view[index];
    if (value !== value) return undefined;
    $putOwnContiguousIndex(from, index, value);
  }
  return from;
}

function mergeIntoTypedArray(view: any, from: number[], endOfRun: number, comparator: unknown): void {
  const count = from.length | 0;
  let end = endOfRun | 0;
  if (((end + 1) | 0) < count) end = extendValueRun<number>(from, end, count, comparator);
  if (((end + 1) | 0) < count) mergeFurtherRuns<number>(from, count, end, comparator, mergeTypedRuns);
  // The comparator may have made the view shorter: a store behind its end does nothing.
  for (let index = 0; index < count; index = (index + 1) | 0) view[index] = $getOwnContiguousIndex<number>(from, index);
}

function sortTypedArrayNatively(view: any, comparator: unknown): void {
  const sorted = $call<any>(Int32Array.prototype.toSorted, view, comparator);
  if ($isTypedArrayOutOfBounds(view)) return;
  const length = $typedArrayLength(view);
  const kept = length < sorted.length ? $call<any>(Int32Array.prototype.subarray, sorted, 0, length) : sorted;
  $call<void>(Int32Array.prototype.set, view, kept);
}

// Of numbers. As in sort(), insertValues() is copied with the comparator.
$overriddenName = "sort";
export function sortTypedArray(this: any, comparator: unknown): any {
  // Behind the values, the scratch array of a merge holds 73 more.
  const mostValuesInArray = 0x10000000 - 73;
  if (!isCallable(comparator) && comparator !== undefined)
    $throwTypeError("TypedArray.prototype.sort requires the comparator argument to be a function or undefined");
  const length = $typedArrayLength(this);
  if (length < 2) return this;
  const from =
    comparator === undefined || length > mostValuesInArray
      ? undefined
      : $callNoInline<number[] | undefined>(copyTypedArrayElements, undefined, this, length | 0);
  if (from === undefined) {
    $callNoInline<void>(sortTypedArrayNatively, undefined, this, comparator);
    return this;
  }
  const count = from.length | 0;
  const inOrder = count < 8 ? 1 : $callNoInline<number>(countValuesInOrder, undefined, from, comparator) | 0;
  const limit = inOrder > 8 ? inOrder : count < 64 ? count : 64;
  insertValues<number>(from, inOrder, limit, comparator);
  $callNoInline<void>(mergeIntoTypedArray, undefined, this, from, (limit - 1) | 0, comparator);
  return this;
}

// Stores the first number of a list where it already lies. True says that the storage is writable, of the same kind and as long as before.
function isWritableBehindFirstStore<T>(array: T[], kind: number, count: number, first: number): boolean {
  const isStored: boolean = $tryPutIndex(array, 0, first);
  if (isStored) return true;
  // This store copies shared storage and throws on a frozen array.
  array[0] = first as unknown as T;
  const isStoredNow: boolean = $tryPutIndex(array, 0, first);
  return isStoredNow && $arrayStorageKind(array) === kind && array.length === count;
}

function trySortManyNumbers<T>(array: T[], kind: number, count: number, direction: number): boolean {
  if (kind === $arrayStorageDouble) {
    const first: number = $getOwnDoubleIndex(array, 0);
    if (first !== first || !isWritableBehindFirstStore<T>(array, kind, count, first)) return false;
    return $sortNumbers(array, direction);
  }
  if (kind !== $arrayStorageInt32 && kind !== $arrayStorageContiguous) return false;
  if (!$hasContiguousIndex(array, 0)) return false;
  const first: unknown = $getContiguousIndex<unknown>(array, 0);
  if (typeof first !== "number" || !isWritableBehindFirstStore<T>(array, kind, count, first)) return false;
  return $sortNumbers(array, direction);
}

// A short list of numbers, sorted where it lies. Any stable order of numbers is the order that sort() makes, and nothing watches: no comparator runs.
// False where it meets something else: a hole, another kind of list, storage that is not writable. Numbers moved in front of a hole are moved as a stable sort moves them, and sort() ends with the same list.
// Nothing is called behind the first store, so the kind, the length and the right to write are asked once.
function trySortNumbersInPlace<T>(array: T[], isDescending: boolean): boolean {
  const forceRunLength = 64;
  const count = array.length;
  const kind = $arrayStorageKind(array);
  // Up to this length sort() sorts by insertion as well.
  if (count > forceRunLength) return trySortManyNumbers<T>(array, kind, count, isDescending ? -1 : 1);
  if (kind === $arrayStorageDouble) {
    // In this storage NaN means a hole: a list that holds NaN has boxed values, and goes to sort() with nothing moved.
    const first: number = $getOwnDoubleIndex(array, 0);
    if (first !== first || !isWritableBehindFirstStore<T>(array, kind, count, first)) return false;
    for (let index = 1; index < count; index = (index + 1) | 0) {
      const value: number = $getOwnDoubleIndex(array, index);
      if (value !== value) return false;
      let position = index;
      while (position > 0) {
        const before: number = $getOwnDoubleIndex(array, (position - 1) | 0);
        if (!(isDescending ? before < value : value < before)) break;
        $putOwnDoubleIndex(array, position, before);
        position = (position - 1) | 0;
      }
      if (position !== index) $putOwnDoubleIndex(array, position, value);
    }
    return true;
  }
  if (kind !== $arrayStorageInt32) return false;
  if (!$hasContiguousIndex(array, 0) || !isWritableBehindFirstStore<T>(array, kind, count, $getOwnInt32Index(array, 0)))
    return false;
  for (let index = 1; index < count; index = (index + 1) | 0) {
    if (!$hasContiguousIndex(array, index)) return false;
    const value: number = $getOwnInt32Index(array, index);
    let position = index;
    while (position > 0) {
      const before: number = $getOwnInt32Index(array, (position - 1) | 0);
      if (!(isDescending ? before < value : value < before)) break;
      $putOwnInt32Index(array, position, before);
      position = (position - 1) | 0;
    }
    if (position !== index) $putOwnInt32Index(array, position, value);
  }
  return true;
}

// The compiler calls these two in the place of sort() where it sees that the comparator is `(a, b) => a - b` or `(a, b) => b - a`.
$visibility = "Private";
export function sortByDifference<T>(array: T[], comparator: unknown): T[] {
  if (array.length < 2 || trySortNumbersInPlace<T>(array, false)) return array;
  return $call<T[]>(sort, array, comparator);
}

$visibility = "Private";
export function sortByReversedDifference<T>(array: T[], comparator: unknown): T[] {
  if (array.length < 2 || trySortNumbersInPlace<T>(array, true)) return array;
  return $call<T[]>(sort, array, comparator);
}

// Storage of another kind need not be as long as the list, as behind `a[300_000_000] = 1`, and the list may be longer than storage in one piece can be.
// The copy grows with what is found, and a result that is longer than the copy is made as the program's own `new Array(length)` is. Array itself is not named here:
// whoever sorts would hold all that stands behind that name.
function toSortedListOfOtherStorage<T>(array: T[], length: number, comparator: unknown): T[] {
  let capacity = 16;
  let from: T[] = $newContiguousArray<T>(capacity);
  let count = 0;
  for (let index = 0; index < length; index++) {
    const value = array[index];
    if (value === undefined) continue;
    if (count === capacity) {
      from = moveToLongerArray<T>(from, count);
      capacity = count * 2;
    }
    $putContiguousIndex(from, count, value);
    count = (count + 1) | 0;
  }
  sortValues<T>(from, count, comparator);
  if (length <= capacity) {
    for (let index = count; index < length; index++) $putOwnContiguousIndex(from, index, undefined);
    return $truncateNewArray<T>(from, length);
  }
  const out = $newArrayLike<unknown>(length, undefined);
  for (let index = 0; index < count; index++) out[index] = $getOwnContiguousIndex<T>(from, index);
  for (let index = count; index < length; index++) out[index] = undefined;
  return out as T[];
}

export function toSorted<T>(this: T[], comparator: unknown): T[] {
  if (!isCallable(comparator)) return (this as any).toSorted(comparator);
  const length = this.length;
  if (isContiguousArray(this)) {
    const from: T[] = $newContiguousArray<T>(length);
    let count = 0;
    for (let index = 0; index < length; index++) {
      const value = $getContiguousIndex<T>(this, index);
      if (value === undefined) continue;
      $putOwnContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
    sortValues<T>(from, count, comparator);
    for (let index = count; index < length; index++) $putOwnContiguousIndex(from, index, undefined);
    return $truncateNewArray<T>(from, length);
  }
  if (!isDoubleArray(this)) return toSortedListOfOtherStorage<T>(this, length, comparator);
  const from: T[] = $newContiguousArray<T>(length);
  let count = 0;
  for (let index = 0; index < length; index++) {
    const value = this[index];
    if (value === undefined) continue;
    $putOwnContiguousIndex(from, count, value);
    count = (count + 1) | 0;
  }
  sortValues<T>(from, count, comparator);
  for (let index = count; index < length; index++) $putOwnContiguousIndex(from, index, undefined);
  return $truncateNewArray<T>(from, length);
}
