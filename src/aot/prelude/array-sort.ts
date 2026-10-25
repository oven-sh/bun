declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $callNoInline<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $arrayStorageKind(a: unknown[]): number;
declare const $arrayStorageInt32: number;
declare const $arrayStorageDouble: number;
declare const $arrayStorageContiguous: number;
declare function $getDoubleIndex(a: unknown[], k: number): number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;
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
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: T = $getContiguousIndex<T>(from, end + 1);
    const last: T = $getContiguousIndex<T>(from, end);
    if (isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  return end;
}

function findNaturalValueRun<T>(from: T[], begin: number, count: number, comparator: unknown): number {
  let end = begin;
  if (end + 1 >= count) return end;
  const first: T = $getContiguousIndex<T>(from, end);
  const second: T = $getContiguousIndex<T>(from, end + 1);
  end = (end + 1) | 0;
  if (!isLess($call<unknown>(comparator, undefined, second, first)))
    return extendValueRun<T>(from, end, count, comparator);
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: T = $getContiguousIndex<T>(from, end + 1);
    const last: T = $getContiguousIndex<T>(from, end);
    if (!isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
    const swapped: T = $getContiguousIndex<T>(from, low);
    $putContiguousIndex(from, low, $getContiguousIndex<T>(from, high));
    $putContiguousIndex(from, high, swapped);
  }
  return end;
}

function insertionSortValues<T>(from: T[], begin: number, end: number, limit: number, comparator: unknown): void {
  for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
    const inserted: T = $getContiguousIndex<T>(from, i);
    let left = begin;
    let right = i;
    while (left < right) {
      const middle = (left + ((right - left) >> 1)) | 0;
      const probe: T = $getContiguousIndex<T>(from, middle);
      if (isLess($call<unknown>(comparator, undefined, inserted, probe))) right = middle;
      else left = (middle + 1) | 0;
    }
    let j = i;
    for (; j - 1 > left; j = (j - 2) | 0) {
      const above: T = $getContiguousIndex<T>(from, j - 1);
      const below: T = $getContiguousIndex<T>(from, j - 2);
      $putContiguousIndex(from, j, above);
      $putContiguousIndex(from, j - 1, below);
    }
    if (j > left) $putContiguousIndex(from, j, $getContiguousIndex<T>(from, j - 1));
    $putContiguousIndex(from, left, inserted);
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

function sortValues<T>(from: T[], count: number, comparator: unknown): void {
  const extendRunCutoff = 8;
  const minGallopThreshold = 7;
  const runStackLength = 72;
  if (count < extendRunCutoff) {
    insertionSortValues<T>(from, 0, 0, count, comparator);
    return;
  }
  let to: T[] = from;
  let depth = 0;
  let previousBegin = 0;
  let previousEnd = 0;
  for (let begin = 0; ;) {
    let end = begin;
    let power = -1;
    if (begin < count) {
      end = findValueRun<T>(from, begin, count, comparator);
      if (begin > 0) power = computeRunPower(previousBegin, begin, end, count);
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
    if (begin > 0) {
      if (to === from) {
        // The scratch array holds the merged elements, then the stack of pending runs, then minGallop.
        to = $newContiguousArray<T>(count + runStackLength + 1);
        $putContiguousIndex(to, count + runStackLength, minGallopThreshold);
      }
      $putContiguousIndex(to, count + depth * 2, previousBegin);
      $putContiguousIndex(to, count + depth * 2 + 1, power);
      depth = (depth + 1) | 0;
    }
    previousBegin = begin;
    previousEnd = end;
    begin = (end + 1) | 0;
  }
}

function extendDoubleRun(from: number[], end: number, count: number, comparator: unknown): number {
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: number = $getDoubleIndex(from, end + 1);
    const last: number = $getDoubleIndex(from, end);
    if (isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  return end;
}

function findNaturalDoubleRun(from: number[], begin: number, count: number, comparator: unknown): number {
  let end = begin;
  if (end + 1 >= count) return end;
  const first: number = $getDoubleIndex(from, end);
  const second: number = $getDoubleIndex(from, end + 1);
  end = (end + 1) | 0;
  if (!isLess($call<unknown>(comparator, undefined, second, first)))
    return extendDoubleRun(from, end, count, comparator);
  for (; end + 1 < count; end = (end + 1) | 0) {
    const next: number = $getDoubleIndex(from, end + 1);
    const last: number = $getDoubleIndex(from, end);
    if (!isLess($call<unknown>(comparator, undefined, next, last))) break;
  }
  for (let low = begin, high = end; low < high; low = (low + 1) | 0, high = (high - 1) | 0) {
    const swapped: number = $getDoubleIndex(from, low);
    $putDoubleIndex(from, low, $getDoubleIndex(from, high));
    $putDoubleIndex(from, high, swapped);
  }
  return end;
}

function insertionSortDoubles(from: number[], begin: number, end: number, limit: number, comparator: unknown): void {
  for (let i = (end + 1) | 0; i < limit; i = (i + 1) | 0) {
    const inserted: number = $getDoubleIndex(from, i);
    let left = begin;
    let right = i;
    while (left < right) {
      const middle = (left + ((right - left) >> 1)) | 0;
      const probe: number = $getDoubleIndex(from, middle);
      if (isLess($call<unknown>(comparator, undefined, inserted, probe))) right = middle;
      else left = (middle + 1) | 0;
    }
    let j = i;
    for (; j - 1 > left; j = (j - 2) | 0) {
      const above: number = $getDoubleIndex(from, j - 1);
      const below: number = $getDoubleIndex(from, j - 2);
      $putDoubleIndex(from, j, above);
      $putDoubleIndex(from, j - 1, below);
    }
    if (j > left) $putDoubleIndex(from, j, $getDoubleIndex(from, j - 1));
    $putDoubleIndex(from, left, inserted);
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
  const minGallopThreshold = 7;
  const runStackLength = 72;
  if (count < extendRunCutoff) {
    insertionSortDoubles(from, 0, 0, count, comparator);
    return;
  }
  let to: number[] = from;
  let depth = 0;
  let previousBegin = 0;
  let previousEnd = 0;
  for (let begin = 0; ;) {
    let end = begin;
    let power = -1;
    if (begin < count) {
      end = findDoubleRun(from, begin, count, comparator);
      if (begin > 0) power = computeRunPower(previousBegin, begin, end, count);
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
    if (begin > 0) {
      if (to === from) {
        // The scratch array holds the merged elements, then the stack of pending runs, then minGallop.
        to = $newDoubleArray(count + runStackLength + 1);
        $putDoubleIndex(to, count + runStackLength, minGallopThreshold);
      }
      $putDoubleIndex(to, count + depth * 2, previousBegin);
      $putDoubleIndex(to, count + depth * 2 + 1, power);
      depth = (depth + 1) | 0;
    }
    previousBegin = begin;
    previousEnd = end;
    begin = (end + 1) | 0;
  }
}

function sortDoubleArray<T>(array: T[], length: number, comparator: unknown): void {
  const from: number[] = $newDoubleArray(length);
  let count = 0;
  for (let index = 0; index < length; index++) {
    const value: number = $getDoubleIndex(array, index);
    if (value !== value) continue;
    $putDoubleIndex(from, count, value);
    count = (count + 1) | 0;
  }
  sortDoubles(from, count, comparator);
  let index = 0;
  if (count > 0) {
    // This store copies shared storage and throws on a frozen array, so the loop below finds writable storage.
    const first: number = $getDoubleIndex(from, 0);
    const isFirstStored: boolean = $tryPutIndex(array, 0, first);
    if (!isFirstStored) array[0] = first as unknown as T;
    // $putDoubleIndex is for arrays that this file made. The program's array may refuse a store: the last loop stores the rest.
    for (index = 1; index < count; index++) {
      const isStored: boolean = $tryPutDoubleIndex(array, index, $getDoubleIndex(from, index));
      if (!isStored) break;
    }
  }
  for (; index < count; index++) {
    const value: number = $getDoubleIndex(from, index);
    const isStored: boolean = $tryPutIndex(array, index, value);
    if (!isStored) array[index] = value as unknown as T;
  }
  for (; index < length; index++) delete array[index];
}

function copyToContiguousArray<T>(values: T[], count: number): T[] {
  const copy: T[] = $newContiguousArray<T>(count);
  for (let index = 0; index < count; index++) $putContiguousIndex(copy, index, values[index]);
  return copy;
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
      const has: boolean = $hasContiguousIndex(this, index);
      if (!has) continue;
      const value = $getContiguousIndex<T>(this, index);
      if (value === undefined) {
        undefinedCount++;
        continue;
      }
      $putContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  } else {
    const defined: T[] = [];
    for (let index = 0; index < length; index++) {
      if (!(index in this)) continue;
      const value = this[index];
      if (value === undefined) undefinedCount++;
      else defined.push(value);
    }
    count = defined.length;
    from = copyToContiguousArray<T>(defined, count);
  }
  sortValues<T>(from, count, comparator);
  let index = 0;
  for (; index < count; index++) {
    const value = $getContiguousIndex<T>(from, index);
    const isStored: boolean = $tryPutIndex(this, index, value);
    if (!isStored) this[index] = value;
  }
  for (; undefinedCount > 0 && index < length; undefinedCount--, index++) this[index] = undefined as unknown as T;
  for (; index < length; index++) delete this[index];
  return this;
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
      $putDoubleIndex(doubles, index, value);
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
      $putContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  } else {
    for (let index = 0; index < length; index++) {
      const value = this[index];
      if (value === undefined) continue;
      $putContiguousIndex(from, count, value);
      count = (count + 1) | 0;
    }
  }
  sortValues<T>(from, count, comparator);
  for (let index = count; index < length; index++) $putContiguousIndex(from, index, undefined);
  return $truncateNewArray<T>(from, length);
}
