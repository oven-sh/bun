declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $callNoInline<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $arrayStorageKind(a: unknown[]): number;
declare const $arrayStorageInt32: number;
declare const $arrayStorageDouble: number;
declare const $arrayStorageContiguous: number;
declare function $getDoubleIndex(a: unknown[], k: number): number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;
// For the arrays that this file made and filled up to `count`: every position that is asked lies below it. The comparator never sees them.
declare function $getOwnContiguousIndex<T>(a: unknown[], k: number): T;
declare function $getOwnDoubleIndex(a: unknown[], k: number): number;
declare function $putOwnContiguousIndex(a: unknown[], k: number, value: unknown): void;
declare function $putOwnDoubleIndex(a: unknown[], k: number, value: number): void;
declare function $truncateNewArray<T>(out: T[], n: number): T[];
declare function $newDoubleArray(n: number): number[];
declare function $newContiguousArray<T>(n: number): T[];
declare function $putDoubleIndex(out: unknown[], k: number, value: number): void;
declare function $putContiguousIndex(out: unknown[], k: number, value: unknown): void;
declare function $tryPutIndex(a: unknown[], k: number, value: unknown): boolean;
declare function $tryPutDoubleIndex(a: unknown[], k: number, value: number): boolean;

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

function isLess(comparatorResult: unknown): boolean {
  if (typeof comparatorResult === "number") return comparatorResult < 0;
  if (typeof comparatorResult === "boolean") return !comparatorResult;
  return +(comparatorResult as any) < 0;
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
  const atHint: unknown = from[base + hint];
  if (isLess($callNoInline<unknown>(comparator, undefined, atHint, key))) {
    const maxOffset = (length - hint) | 0;
    while (offset < maxOffset) {
      const probe: unknown = from[base + hint + offset];
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
      const probe: unknown = from[base + hint - offset];
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
    const probe: unknown = from[base + middle];
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
  const atHint: unknown = from[base + hint];
  if (!isLess($callNoInline<unknown>(comparator, undefined, key, atHint))) {
    const maxOffset = (length - hint) | 0;
    while (offset < maxOffset) {
      const probe: unknown = from[base + hint + offset];
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
      const probe: unknown = from[base + hint - offset];
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
    const probe: unknown = from[base + middle];
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

function findNaturalValueRun<T>(from: T[], begin: number, count: number, comparator: unknown): number {
  let end = begin;
  if (end + 1 >= count) return end;
  const first: T = $getOwnContiguousIndex<T>(from, end);
  const second: T = $getOwnContiguousIndex<T>(from, end + 1);
  end = (end + 1) | 0;
  if (!isLess($call<unknown>(comparator, undefined, second, first)))
    return extendValueRun<T>(from, end, count, comparator);
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: T = $getOwnContiguousIndex<T>(from, end + 1);
    const last: T = $getOwnContiguousIndex<T>(from, end);
    if (!isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
    const swapped: T = $getOwnContiguousIndex<T>(from, low);
    $putOwnContiguousIndex(from, low, $getOwnContiguousIndex<T>(from, high));
    $putOwnContiguousIndex(from, high, swapped);
  }
  return end;
}

function insertionSortValues<T>(from: T[], begin: number, end: number, limit: number, comparator: unknown): void {
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
}

function findValueRun<T>(from: T[], begin: number, count: number, comparator: unknown): number {
  const extendRunCutoff = 8;
  const forceRunLength = 64;
  let end = findNaturalValueRun<T>(from, begin, count, comparator);
  if (end - begin < extendRunCutoff) {
    const limit = count - begin < forceRunLength ? count : (begin + forceRunLength) | 0;
    insertionSortValues<T>(from, begin, end, limit, comparator);
    end = (limit - 1) | 0;
  }
  return extendValueRun<T>(from, end, count, comparator);
}

function mergeValueRuns<T>(from: T[], to: T[], low: number, middle: number, end: number, comparator: unknown): void {
  const minGallopThreshold = 7;
  let left = (low + gallopRight($getContiguousIndex<T>(from, middle), from, low, middle - low, 0, comparator)) | 0;
  if (left >= middle) return;
  const high =
    (middle +
      gallopLeft($getContiguousIndex<T>(from, middle - 1), from, middle, end + 1 - middle, end - middle, comparator)) |
    0;
  if (high <= middle) return;
  const minGallopIndex = (to.length - 1) | 0;
  let minGallop = $getContiguousIndex<number>(to, minGallopIndex) | 0;
  const first = left;
  let right = middle;
  let target = left;
  merging: for (;;) {
    let leftWins = 0;
    let rightWins = 0;
    while (leftWins < minGallop && rightWins < minGallop) {
      if (right >= high || left >= middle) break merging;
      const leftValue: T = $getContiguousIndex<T>(from, left);
      const rightValue: T = $getContiguousIndex<T>(from, right);
      if (isLess($call<unknown>(comparator, undefined, rightValue, leftValue))) {
        $putContiguousIndex(to, target, rightValue);
        right = (right + 1) | 0;
        rightWins = (rightWins + 1) | 0;
        leftWins = 0;
      } else {
        $putContiguousIndex(to, target, leftValue);
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
      leftWins = gallopRight($getContiguousIndex<T>(from, right), from, left, middle - left, 0, comparator);
      for (let k = 0; k < leftWins; k = (k + 1) | 0, target = (target + 1) | 0, left = (left + 1) | 0)
        $putContiguousIndex(to, target, $getContiguousIndex<T>(from, left));
      $putContiguousIndex(to, target, $getContiguousIndex<T>(from, right));
      target = (target + 1) | 0;
      right = (right + 1) | 0;
      if (left >= middle || right >= high) break merging;
      rightWins = gallopLeft($getContiguousIndex<T>(from, left), from, right, high - right, 0, comparator);
      for (let k = 0; k < rightWins; k = (k + 1) | 0, target = (target + 1) | 0, right = (right + 1) | 0)
        $putContiguousIndex(to, target, $getContiguousIndex<T>(from, right));
      $putContiguousIndex(to, target, $getContiguousIndex<T>(from, left));
      target = (target + 1) | 0;
      left = (left + 1) | 0;
      if (left >= middle || right >= high) break merging;
    } while (leftWins >= minGallopThreshold || rightWins >= minGallopThreshold);
    minGallop = (minGallop + 1) | 0;
  }
  $putContiguousIndex(to, minGallopIndex, minGallop);
  for (; left < middle; left = (left + 1) | 0, target = (target + 1) | 0)
    $putContiguousIndex(to, target, $getContiguousIndex<T>(from, left));
  for (; right < high; right = (right + 1) | 0, target = (target + 1) | 0)
    $putContiguousIndex(to, target, $getContiguousIndex<T>(from, right));
  for (let k = first; k < high; k = (k + 1) | 0) $putContiguousIndex(from, k, $getContiguousIndex<T>(to, k));
}

// The compiler copies the functions that a comparator passes through for that comparator, so those are kept short:
// what needs no comparator, and what only long arrays need, stands in functions of its own.
function sortValues<T>(from: T[], count: number, comparator: unknown): void {
  const extendRunCutoff = 8;
  if (count < extendRunCutoff) {
    insertionSortValues<T>(from, 0, 0, count, comparator);
    return;
  }
  // A short array is one run once its first run is found.
  const end = findValueRun<T>(from, 0, count, comparator) | 0;
  if (((end + 1) | 0) < count) mergeFurtherValueRuns<T>(from, count, end, comparator);
}

function mergeFurtherValueRuns<T>(from: T[], count: number, endOfFirstRun: number, comparator: unknown): void {
  const minGallopThreshold = 7;
  const runStackLength = 72;
  let to: T[] = from;
  let depth = 0;
  let previousBegin = 0;
  let previousEnd = endOfFirstRun;
  for (let begin = (endOfFirstRun + 1) | 0; ; ) {
    let end = begin;
    let power = -1;
    if (begin < count) {
      end = findValueRun<T>(from, begin, count, comparator);
      power = computeRunPower(previousBegin, begin, end, count);
    }
    while (depth > 0) {
      const powerBelow: number = $getContiguousIndex<number>(to, count + depth * 2 - 1);
      if (powerBelow <= power) break;
      depth = (depth - 1) | 0;
      const low: number = $getContiguousIndex<number>(to, count + depth * 2) | 0;
      mergeValueRuns<T>(from, to, low, previousBegin, previousEnd, comparator);
      previousBegin = low;
    }
    if (begin >= count) return;
    if (to === from) {
      // The scratch array holds the merged elements, then the stack of pending runs, then minGallop.
      to = $newContiguousArray<T>(count + runStackLength + 1);
      $putContiguousIndex(to, count + runStackLength, minGallopThreshold);
    }
    $putContiguousIndex(to, count + depth * 2, previousBegin);
    $putContiguousIndex(to, count + depth * 2 + 1, power);
    depth = (depth + 1) | 0;
    previousBegin = begin;
    previousEnd = end;
    begin = (end + 1) | 0;
  }
}

function extendDoubleRun(from: number[], end: number, count: number, comparator: unknown): number {
  for (end = end | 0, count = count | 0; ((end + 1) | 0) < count; end = (end + 1) | 0) {
    const next: number = $getOwnDoubleIndex(from, (end + 1) | 0);
    const last: number = $getOwnDoubleIndex(from, end);
    if (isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  return end;
}

function findNaturalDoubleRun(from: number[], begin: number, count: number, comparator: unknown): number {
  let end = begin;
  if (end + 1 >= count) return end;
  const first: number = $getOwnDoubleIndex(from, end);
  const second: number = $getOwnDoubleIndex(from, end + 1);
  end = (end + 1) | 0;
  if (!isLess($call<unknown>(comparator, undefined, second, first)))
    return extendDoubleRun(from, end, count, comparator);
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: number = $getOwnDoubleIndex(from, end + 1);
    const last: number = $getOwnDoubleIndex(from, end);
    if (!isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
    const swapped: number = $getOwnDoubleIndex(from, low);
    $putOwnDoubleIndex(from, low, $getOwnDoubleIndex(from, high));
    $putOwnDoubleIndex(from, high, swapped);
  }
  return end;
}

function insertionSortDoubles(from: number[], begin: number, end: number, limit: number, comparator: unknown): void {
  for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
    const inserted: number = $getOwnDoubleIndex(from, i);
    let left = begin;
    let right = i;
    while (left < right) {
      const middle = (left + ((right - left) >> 1)) | 0;
      const probe: number = $getOwnDoubleIndex(from, middle);
      if (isLess($call<unknown>(comparator, undefined, inserted, probe))) right = middle;
      else left = (middle + 1) | 0;
    }
    let j = i;
    for (; j - 1 > left; j = (j - 2) | 0) {
      const above: number = $getOwnDoubleIndex(from, j - 1);
      const below: number = $getOwnDoubleIndex(from, j - 2);
      $putOwnDoubleIndex(from, j, above);
      $putOwnDoubleIndex(from, j - 1, below);
    }
    if (j > left) $putOwnDoubleIndex(from, j, $getOwnDoubleIndex(from, j - 1));
    $putOwnDoubleIndex(from, left, inserted);
  }
}

function findDoubleRun(from: number[], begin: number, count: number, comparator: unknown): number {
  const extendRunCutoff = 8;
  const forceRunLength = 64;
  let end = findNaturalDoubleRun(from, begin, count, comparator);
  if (end - begin < extendRunCutoff) {
    const limit = count - begin < forceRunLength ? count : (begin + forceRunLength) | 0;
    insertionSortDoubles(from, begin, end, limit, comparator);
    end = (limit - 1) | 0;
  }
  return extendDoubleRun(from, end, count, comparator);
}

function mergeDoubleRuns(
  from: number[],
  to: number[],
  low: number,
  middle: number,
  end: number,
  comparator: unknown,
): void {
  const minGallopThreshold = 7;
  let left = (low + gallopRight($getDoubleIndex(from, middle), from, low, middle - low, 0, comparator)) | 0;
  if (left >= middle) return;
  const high =
    (middle + gallopLeft($getDoubleIndex(from, middle - 1), from, middle, end + 1 - middle, end - middle, comparator)) |
    0;
  if (high <= middle) return;
  const minGallopIndex = (to.length - 1) | 0;
  let minGallop = $getDoubleIndex(to, minGallopIndex) | 0;
  const first = left;
  let right = middle;
  let target = left;
  merging: for (;;) {
    let leftWins = 0;
    let rightWins = 0;
    while (leftWins < minGallop && rightWins < minGallop) {
      if (right >= high || left >= middle) break merging;
      const leftValue: number = $getDoubleIndex(from, left);
      const rightValue: number = $getDoubleIndex(from, right);
      if (isLess($call<unknown>(comparator, undefined, rightValue, leftValue))) {
        $putDoubleIndex(to, target, rightValue);
        right = (right + 1) | 0;
        rightWins = (rightWins + 1) | 0;
        leftWins = 0;
      } else {
        $putDoubleIndex(to, target, leftValue);
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
      leftWins = gallopRight($getDoubleIndex(from, right), from, left, middle - left, 0, comparator);
      for (let k = 0; k < leftWins; k = (k + 1) | 0, target = (target + 1) | 0, left = (left + 1) | 0)
        $putDoubleIndex(to, target, $getDoubleIndex(from, left));
      $putDoubleIndex(to, target, $getDoubleIndex(from, right));
      target = (target + 1) | 0;
      right = (right + 1) | 0;
      if (left >= middle || right >= high) break merging;
      rightWins = gallopLeft($getDoubleIndex(from, left), from, right, high - right, 0, comparator);
      for (let k = 0; k < rightWins; k = (k + 1) | 0, target = (target + 1) | 0, right = (right + 1) | 0)
        $putDoubleIndex(to, target, $getDoubleIndex(from, right));
      $putDoubleIndex(to, target, $getDoubleIndex(from, left));
      target = (target + 1) | 0;
      left = (left + 1) | 0;
      if (left >= middle || right >= high) break merging;
    } while (leftWins >= minGallopThreshold || rightWins >= minGallopThreshold);
    minGallop = (minGallop + 1) | 0;
  }
  $putDoubleIndex(to, minGallopIndex, minGallop);
  for (; left < middle; left = (left + 1) | 0, target = (target + 1) | 0)
    $putDoubleIndex(to, target, $getDoubleIndex(from, left));
  for (; right < high; right = (right + 1) | 0, target = (target + 1) | 0)
    $putDoubleIndex(to, target, $getDoubleIndex(from, right));
  for (let k = first; k < high; k = (k + 1) | 0) $putDoubleIndex(from, k, $getDoubleIndex(to, k));
}

function sortDoubles(from: number[], count: number, comparator: unknown): void {
  const extendRunCutoff = 8;
  if (count < extendRunCutoff) {
    insertionSortDoubles(from, 0, 0, count, comparator);
    return;
  }
  const end = findDoubleRun(from, 0, count, comparator) | 0;
  if (((end + 1) | 0) < count) mergeFurtherDoubleRuns(from, count, end, comparator);
}

function mergeFurtherDoubleRuns(from: number[], count: number, endOfFirstRun: number, comparator: unknown): void {
  const minGallopThreshold = 7;
  const runStackLength = 72;
  let to: number[] = from;
  let depth = 0;
  let previousBegin = 0;
  let previousEnd = endOfFirstRun;
  for (let begin = (endOfFirstRun + 1) | 0; ; ) {
    let end = begin;
    let power = -1;
    if (begin < count) {
      end = findDoubleRun(from, begin, count, comparator);
      power = computeRunPower(previousBegin, begin, end, count);
    }
    while (depth > 0) {
      const powerBelow: number = $getDoubleIndex(to, count + depth * 2 - 1);
      if (powerBelow <= power) break;
      depth = (depth - 1) | 0;
      const low: number = $getDoubleIndex(to, count + depth * 2) | 0;
      mergeDoubleRuns(from, to, low, previousBegin, previousEnd, comparator);
      previousBegin = low;
    }
    if (begin >= count) return;
    if (to === from) {
      // The scratch array holds the merged elements, then the stack of pending runs, then minGallop.
      to = $newDoubleArray(count + runStackLength + 1);
      $putDoubleIndex(to, count + runStackLength, minGallopThreshold);
    }
    $putDoubleIndex(to, count + depth * 2, previousBegin);
    $putDoubleIndex(to, count + depth * 2 + 1, power);
    depth = (depth + 1) | 0;
    previousBegin = begin;
    previousEnd = end;
    begin = (end + 1) | 0;
  }
}

// From the first store that the program's array refused on.
function putRestOfSortedDoubles<T>(array: T[], length: number, from: number[], count: number, index: number): void {
  for (; index < count; index++) {
    const value: number = $getDoubleIndex(from, index);
    const isStored: boolean = $tryPutIndex(array, index, value);
    if (!isStored) array[index] = value as unknown as T;
  }
  for (; index < length; index++) delete array[index];
}

function sortDoubleArray<T>(array: T[], length: number, comparator: unknown): void {
  const from: number[] = $newDoubleArray(length);
  let count = 0;
  for (let index = 0; index < length; index++) {
    const value: number = $getDoubleIndex(array, index);
    if (value !== value) continue;
    $putOwnDoubleIndex(from, count, value);
    count = (count + 1) | 0;
  }
  sortDoubles(from, count, comparator);
  let index = 0;
  if (count > 0) {
    // This store copies shared storage and throws on a frozen array, so the loop below finds writable storage.
    const first: number = $getOwnDoubleIndex(from, 0);
    const isFirstStored: boolean = $tryPutIndex(array, 0, first);
    if (!isFirstStored) array[0] = first as unknown as T;
    // $putDoubleIndex is for arrays that this file made. The program's array may refuse a store.
    for (index = 1; index < count; index++) {
      const isStored: boolean = $tryPutDoubleIndex(array, index, $getOwnDoubleIndex(from, index));
      if (!isStored) break;
    }
  }
  if (index < length) putRestOfSortedDoubles<T>(array, length, from, count, index);
}

// What an array of another kind holds but for holes and undefined, and behind that how many values these are and how often undefined was met.
function takeDefinedValuesOneByOne<T>(array: T[], length: number): T[] {
  const from: T[] = $newContiguousArray<T>(length + 2);
  let count = 0;
  let undefinedCount = 0;
  for (let index = 0; index < length; index++) {
    if (!(index in array)) continue;
    const value = array[index];
    if (value === undefined) {
      undefinedCount++;
      continue;
    }
    $putContiguousIndex(from, count, value);
    count = (count + 1) | 0;
  }
  $putContiguousIndex(from, length, count);
  $putContiguousIndex(from, length + 1, undefinedCount);
  return from;
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

export function sort<T>(this: T[], comparator: unknown): T[] {
  if (!isCallable(comparator)) return (this as any).sort(comparator);
  const length = this.length;
  if (length < 2) return this;
  if (isDoubleArray(this)) {
    // Not a tail call: a stack trace that the comparator makes has the frame of sort.
    sortDoubleArray<T>(this, length, comparator);
    return this;
  }
  let from: T[];
  let count = 0;
  let undefinedCount = 0;
  if (isContiguousArray(this)) {
    from = $newContiguousArray<T>(length);
    for (let index = 0; index < length; index++) {
      const value = $getContiguousIndex<T>(this, index);
      if (value === undefined) {
        // A hole reads as undefined too.
        const has: boolean = $hasContiguousIndex(this, index);
        if (has) undefinedCount++;
        continue;
      }
      $putOwnContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  } else {
    from = takeDefinedValuesOneByOne<T>(this, length);
    count = $getContiguousIndex<number>(from, length) | 0;
    undefinedCount = $getContiguousIndex<number>(from, length + 1) | 0;
  }
  sortValues<T>(from, count, comparator);
  let index = 0;
  if (count > 0) {
    // A store that is taken says that the storage is writable. No call stands between it and the loop, so one look at the kind and the length does for every store.
    const isFirstStored: boolean = $tryPutIndex(this, 0, $getOwnContiguousIndex<T>(from, 0));
    if (isFirstStored) {
      index = 1;
      // Storage for integers has been that since before the values were taken out of it.
      if (isContiguousArray(this) && count <= this.length)
        for (; index < count; index = (index + 1) | 0)
          $putOwnContiguousIndex(this, index, $getOwnContiguousIndex<T>(from, index));
    }
  }
  if (index < length) putRestOfSortedValues<T>(this, length, from, count, index, undefinedCount);
  return this;
}

function storeRefused<T>(array: T[], index: number, value: number): void {
  array[index] = value as unknown as T;
}

// A short list of numbers, sorted where it lies. Any stable order of numbers is the order that sort() makes, and nothing watches: no comparator runs.
// False where it meets something else: a hole, another kind of list, a store that is refused. Numbers moved in front of a hole are moved as a stable sort moves them, and sort() ends with the same list.
// No call comes back into a loop: the storage and its length stay in registers.
function trySortNumbersInPlace<T>(array: T[], isDescending: boolean): boolean {
  const forceRunLength = 64;
  const count = array.length;
  // Up to this length sort() sorts by insertion as well.
  if (count > forceRunLength) return false;
  const kind = $arrayStorageKind(array);
  if (kind === $arrayStorageDouble) {
    // In this storage NaN means a hole: a list that holds NaN has boxed values, and goes to sort() with nothing moved.
    const first: number = $getDoubleIndex(array, 0);
    if (first !== first) return false;
    // This store copies shared storage and throws on a frozen array.
    const isFirstStored: boolean = $tryPutIndex(array, 0, first);
    if (!isFirstStored) storeRefused<T>(array, 0, first);
    for (let index = 1; index < count; index = (index + 1) | 0) {
      const value: number = $getDoubleIndex(array, index);
      if (value !== value) return false;
      let position = index;
      while (position > 0) {
        const before: number = $getDoubleIndex(array, (position - 1) | 0);
        if (!(isDescending ? before < value : value < before)) break;
        const isMoved: boolean = $tryPutDoubleIndex(array, position, before);
        if (!isMoved) {
          storeRefused<T>(array, position, before);
          storeRefused<T>(array, position - 1, value);
          return false;
        }
        position = (position - 1) | 0;
      }
      if (position === index) continue;
      const isStored: boolean = $tryPutDoubleIndex(array, position, value);
      if (!isStored) {
        storeRefused<T>(array, position, value);
        return false;
      }
    }
    return true;
  }
  if (kind !== $arrayStorageInt32) return false;
  const first = $getContiguousIndex<number | undefined>(array, 0);
  if (first === undefined) return false;
  const isFirstStored: boolean = $tryPutIndex(array, 0, first);
  if (!isFirstStored) storeRefused<T>(array, 0, first);
  for (let index = 1; index < count; index = (index + 1) | 0) {
    const element = $getContiguousIndex<number | undefined>(array, index);
    if (element === undefined) return false;
    const value = element | 0;
    let position = index;
    while (position > 0) {
      const before = $getContiguousIndex<number>(array, (position - 1) | 0) | 0;
      if (!(isDescending ? before < value : value < before)) break;
      const isMoved: boolean = $tryPutIndex(array, position, before);
      if (!isMoved) {
        storeRefused<T>(array, position, before);
        storeRefused<T>(array, position - 1, value);
        return false;
      }
      position = (position - 1) | 0;
    }
    if (position === index) continue;
    const isStored: boolean = $tryPutIndex(array, position, value);
    if (!isStored) {
      storeRefused<T>(array, position, value);
      return false;
    }
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

export function toSorted<T>(this: T[], comparator: unknown): T[] {
  if (!isCallable(comparator)) return (this as any).toSorted(comparator);
  const length = this.length;
  if (isDoubleArray(this)) {
    const doubles: number[] = $newDoubleArray(length);
    let index = 0;
    for (; index < length; index++) {
      const value: number = $getDoubleIndex(this, index);
      if (value !== value) break;
      $putOwnDoubleIndex(doubles, index, value);
    }
    if (index === length) {
      sortDoubles(doubles, length, comparator);
      return $truncateNewArray<T>(doubles as unknown as T[], length);
    }
  } else if ($arrayStorageKind(this) === $arrayStorageInt32) {
    const doubles: number[] = $newDoubleArray(length);
    let index = 0;
    for (; index < length; index++) {
      const value = $getContiguousIndex<number | undefined>(this, index);
      if (value === undefined) break;
      $putOwnDoubleIndex(doubles, index, value);
    }
    if (index === length) {
      sortDoubles(doubles, length, comparator);
      return $truncateNewArray<T>(doubles as unknown as T[], length);
    }
  }
  const from: T[] = $newContiguousArray<T>(length);
  let count = 0;
  if (isContiguousArray(this)) {
    for (let index = 0; index < length; index++) {
      const value = $getContiguousIndex<T>(this, index);
      if (value === undefined) continue;
      $putOwnContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  } else {
    for (let index = 0; index < length; index++) {
      const value = this[index];
      if (value === undefined) continue;
      $putOwnContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  }
  sortValues<T>(from, count, comparator);
  for (let index = count; index < length; index++) $putOwnContiguousIndex(from, index, undefined);
  return $truncateNewArray<T>(from, length);
}
