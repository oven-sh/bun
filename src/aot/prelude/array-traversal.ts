// These functions stand for what the program wrote. A stack trace names none of them.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isArray(value: unknown): value is unknown[];
declare function $isJSArray(value: unknown): boolean;
declare function $toLength(value: unknown): number;
declare function $newArrayLike<T>(n: number, a: unknown[] | undefined): T[];
declare function $newArrayWithCapacity<T>(n: number, a: unknown[]): T[];
declare function $tryPutByValDirect(out: unknown[], k: number, value: unknown): boolean;
declare function $tryPutIndex(a: unknown[], k: number, value: unknown): boolean;
declare function $arrayStorageKind(a: unknown[]): number;
declare const $arrayStorageInt32: number;
declare const $arrayStorageDouble: number;
declare const $arrayStorageContiguous: number;
declare function $getDoubleIndex(a: unknown[], k: number): number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;
declare function $growNewArray(out: unknown[], n: number): void;
declare function $truncateNewArray<T>(out: T[], n: number): T[];

function clampToLength(position: number, length: number): number {
  if (position < 0) {
    const fromEnd = length + position;
    return fromEnd < 0 ? 0 : fromEnd >>> 0;
  }
  return (position < length ? position : length) >>> 0;
}

function storeInNewArray(out: unknown[], position: number, value: unknown): void {
  const isStored: boolean = $tryPutByValDirect(out, position, value);
  if (!isStored) out[position] = value;
}

// The array may be of any kind here: what made it is out of sight. A store above its length makes it longer.
function storeInArrayOfAnyKind(out: unknown[], position: number, value: unknown): void {
  const isStored: boolean = $tryPutIndex(out, position, value);
  if (!isStored) out[position] = value;
}

// An array never holds 2 ** 32 elements, so the position fits an unsigned 32-bit integer.
function appendList(out: unknown[], start: number, list: unknown[], count: number): number {
  let position = start >>> 0;
  // A Proxy of an array is an array to flatMap, and has no storage to read.
  const kind = $isJSArray(list) ? $arrayStorageKind(list) : -1;
  let index = 0;
  // The elements of a plain vector are read without a look at the kind of each. A hole ends the run: what stands for it is looked up below.
  if (kind === $arrayStorageContiguous || kind === $arrayStorageInt32) {
    if (position + count > out.length) $growNewArray(out, position + count);
    for (; index < count && $hasContiguousIndex(list, index); index++) {
      storeInArrayOfAnyKind(out, position, $getContiguousIndex<unknown>(list, index));
      position = (position + 1) >>> 0;
    }
  } else if (kind === $arrayStorageDouble) {
    if (position + count > out.length) $growNewArray(out, position + count);
    for (; index < count; index++) {
      const value = $getDoubleIndex(list, index);
      if (value !== value) break;
      storeInArrayOfAnyKind(out, position, value);
      position = (position + 1) >>> 0;
    }
  }
  for (; index < count; index++) {
    if (!(index in list)) continue;
    if (position >= out.length) $growNewArray(out, position);
    storeInArrayOfAnyKind(out, position, list[index]);
    position = (position + 1) >>> 0;
  }
  return position;
}

function joinedText(value: unknown): string {
  return value === undefined || value === null ? "" : `${value}`;
}

function finishJoin(text: string, separator: string, separators: number, total: number): string {
  for (; separators + 1 < total; separators++) text += separator;
  return text;
}

function finishReduce(hasAccumulator: boolean, accumulator: unknown): unknown {
  if (!hasAccumulator) throw new TypeError("reduce of empty array with no initial value");
  return accumulator;
}

$visibility = "Private";
export function traverseArray(
  array: unknown[],
  start: number,
  end: number | undefined,
  shape: number,
  operands: unknown[],
  operand: unknown,
): unknown {
  const linkMap = 1;
  const linkFilter = 2;
  const endArray = 0;
  const endLength = 1;
  const endForEach = 2;
  const endReduce = 3;
  const endSome = 4;
  const endEvery = 5;
  const endFind = 6;
  const endFindIndex = 7;
  const endJoin = 8;
  const endFlatMap = 9;
  const endMask = 15;
  const linkMask = 3;
  const firstLinkShift = 4;
  const secondLinkShift = 6;
  const thirdLinkShift = 8;
  const hasInitialValueShift = 10;
  const flattensShortListsShift = 11;
  const runsLinksOnEveryElementShift = 12;
  const endCallbackIndex = 6;
  const shortListLength = 3;

  const endKind = shape & endMask;
  const firstLink = (shape >> firstLinkShift) & linkMask;
  const secondLink = (shape >> secondLinkShift) & linkMask;
  const thirdLink = (shape >> thirdLinkShift) & linkMask;
  const isDense = firstLink === linkFilter || secondLink === linkFilter || thirdLink === linkFilter;
  const visitsHoles = !isDense && (endKind === endFind || endKind === endFindIndex);
  const flattensShortLists = ((shape >> flattensShortListsShift) & 1) === 1;
  // What a link does on an element behind the answer of `some`, `every`, `find` or `findIndex` would be missed: the links go on to the last element, the end is asked no more.
  const runsLinksOnEveryElement = ((shape >> runsLinksOnEveryElementShift) & 1) === 1;
  const endCallback = operands[endCallbackIndex];
  const endThis = operands[endCallbackIndex + 1];

  const length = array.length;
  const first = start === 0 ? 0 : clampToLength(start, length);
  const last = end === undefined ? length : clampToLength(end, length);
  const count = first === 0 ? last : last > first ? last - first : 0;

  let passedFirst = 0;
  let passedSecond = 0;
  let passedThird = 0;
  let reached = 0;
  let accumulator = operand;
  let hasAccumulator = ((shape >> hasInitialValueShift) & 1) === 1;
  let text = "";
  let isAnswered = false;
  let found: unknown = undefined;
  let foundIndex = -1;
  let out: unknown[] | undefined = undefined;
  if (endKind === endArray && !isDense) out = $newArrayLike<unknown>(count, array);
  else if (endKind === endArray) out = $newArrayWithCapacity<unknown>(count, array);
  // Leaves room for two elements per call. The capacity is a guess that no program can observe.
  else if (endKind === endFlatMap) out = $newArrayWithCapacity<unknown>((count + count) >>> 0, array);

  // A store that the new array does not take leaves the loop, which is entered anew: what the loop knows of the two arrays it has from in front of itself.
  let position = first;
  entered: for (;;) {
    for (; position < last; position++) {
      let index = position - first;
      if (!(position in array)) {
        if (
          visitsHoles &&
          !(runsLinksOnEveryElement && isAnswered) &&
          $call<unknown>(endCallback, endThis, undefined, index)
        ) {
          if (!runsLinksOnEveryElement) return endKind === endFind ? undefined : index;
          isAnswered = true;
          foundIndex = index;
        }
        continue;
      }
      let value: unknown = array[position];

      if (firstLink === linkMap) value = $call<unknown>(operands[0], operands[1], value, index, array);
      else if (firstLink === linkFilter) {
        if (!$call<unknown>(operands[0], operands[1], value, index, array)) continue;
        index = passedFirst;
        passedFirst = (index + 1) >>> 0;
      }
      if (secondLink === linkMap) value = $call<unknown>(operands[2], operands[3], value, index);
      else if (secondLink === linkFilter) {
        if (!$call<unknown>(operands[2], operands[3], value, index)) continue;
        index = passedSecond;
        passedSecond = (index + 1) >>> 0;
      }
      if (thirdLink === linkMap) value = $call<unknown>(operands[4], operands[5], value, index);
      else if (thirdLink === linkFilter) {
        if (!$call<unknown>(operands[4], operands[5], value, index)) continue;
        index = passedThird;
        passedThird = (index + 1) >>> 0;
      }

      if (runsLinksOnEveryElement && isAnswered) continue;
      if (endKind === endArray) {
        const isStored: boolean = $tryPutByValDirect(out!, index, value);
        if (!isStored) {
          out![index] = value;
          position = (position + 1) >>> 0;
          continue entered;
        }
      } else if (endKind === endLength) continue;
      else if (endKind === endForEach) $call<unknown>(endCallback, endThis, value, index);
      else if (endKind === endReduce) {
        accumulator = hasAccumulator ? $call<unknown>(endCallback, undefined, accumulator, value, index) : value;
        hasAccumulator = true;
      } else if (endKind === endSome) {
        if ($call<unknown>(endCallback, endThis, value, index)) {
          if (!runsLinksOnEveryElement) return true;
          isAnswered = true;
        }
      } else if (endKind === endEvery) {
        if (!$call<unknown>(endCallback, endThis, value, index)) {
          if (!runsLinksOnEveryElement) return false;
          isAnswered = true;
        }
      } else if (endKind === endFind) {
        if ($call<unknown>(endCallback, endThis, value, index)) {
          if (!runsLinksOnEveryElement) return value;
          isAnswered = true;
          found = value;
        }
      } else if (endKind === endFindIndex) {
        if ($call<unknown>(endCallback, endThis, value, index)) {
          if (!runsLinksOnEveryElement) return index;
          isAnswered = true;
          foundIndex = index;
        }
      } else if (endKind === endJoin) {
        for (; reached < index; reached++) text += operand as string;
        text += joinedText(value);
      } else {
        const parts: unknown = $call<unknown>(endCallback, endThis, value, index, array);
        if (!$isArray(parts)) {
          if (reached >= out!.length) $growNewArray(out!, reached);
          storeInNewArray(out!, reached, parts);
          reached = (reached + 1) >>> 0;
          continue;
        }
        const count = $toLength(parts.length);
        if (count === 0) continue;
        if (!flattensShortLists || count > shortListLength) {
          reached = appendList(out!, reached, parts, count);
          continue;
        }
        // A short list is read at constant positions: a list literal that the callback returns is then never made.
        if (reached + count > out!.length) $growNewArray(out!, reached + count);
        if (count > 0 && 0 in parts) {
          storeInNewArray(out!, reached, parts[0]);
          reached = (reached + 1) >>> 0;
        }
        if (count > 1 && 1 in parts) {
          storeInNewArray(out!, reached, parts[1]);
          reached = (reached + 1) >>> 0;
        }
        if (count > 2 && 2 in parts) {
          storeInNewArray(out!, reached, parts[2]);
          reached = (reached + 1) >>> 0;
        }
      }
    }
    break;
  }

  const passed = thirdLink === linkFilter ? passedThird : secondLink === linkFilter ? passedSecond : passedFirst;
  if (endKind === endFlatMap) return $truncateNewArray<unknown>(out!, reached);
  if (out !== undefined) return isDense ? $truncateNewArray<unknown>(out, passed) : out;
  if (endKind === endLength) return isDense ? passed : count;
  if (endKind === endReduce) return finishReduce(hasAccumulator, accumulator);
  if (endKind === endJoin) return finishJoin(text, operand as string, reached, isDense ? reached + 1 : count);
  if (runsLinksOnEveryElement)
    return endKind === endSome
      ? isAnswered
      : endKind === endEvery
        ? !isAnswered
        : endKind === endFindIndex
          ? foundIndex
          : found;
  return endKind === endSome ? false : endKind === endEvery ? true : endKind === endFindIndex ? -1 : undefined;
}
