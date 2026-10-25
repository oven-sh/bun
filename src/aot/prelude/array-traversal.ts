// These functions stand for what the program wrote. A stack trace names none of them.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $isArray(value: unknown): value is unknown[];
declare function $toLength(value: unknown): number;
declare function $newArrayLike<T>(n: number, a: unknown[] | undefined): T[];
declare function $newArrayWithCapacity<T>(n: number, a: unknown[]): T[];
declare function $tryPutByValDirect(out: unknown[], k: number, value: unknown): boolean;
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

// An array never holds 2 ** 32 elements, so the position fits an unsigned 32-bit integer.
function appendParts(out: unknown[], start: number, parts: unknown): number {
  let position = start >>> 0;
  if (!$isArray(parts)) {
    if (position >= out.length) $growNewArray(out, position);
    storeInNewArray(out, position, parts);
    return (position + 1) >>> 0;
  }
  const count = $toLength(parts.length);
  for (let index = 0; index < count; index++) {
    if (!(index in parts)) continue;
    if (position >= out.length) $growNewArray(out, position);
    storeInNewArray(out, position, parts[index]);
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
  const endCallbackIndex = 6;

  const endKind = shape & endMask;
  const firstLink = (shape >> firstLinkShift) & linkMask;
  const secondLink = (shape >> secondLinkShift) & linkMask;
  const thirdLink = (shape >> thirdLinkShift) & linkMask;
  const isDense = firstLink === linkFilter || secondLink === linkFilter || thirdLink === linkFilter;
  const visitsHoles = !isDense && (endKind === endFind || endKind === endFindIndex);
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
        if (visitsHoles && $call<unknown>(endCallback, endThis, undefined, index))
          return endKind === endFind ? undefined : index;
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
        if ($call<unknown>(endCallback, endThis, value, index)) return true;
      } else if (endKind === endEvery) {
        if (!$call<unknown>(endCallback, endThis, value, index)) return false;
      } else if (endKind === endFind) {
        if ($call<unknown>(endCallback, endThis, value, index)) return value;
      } else if (endKind === endFindIndex) {
        if ($call<unknown>(endCallback, endThis, value, index)) return index;
      } else if (endKind === endJoin) {
        for (; reached < index; reached++) text += operand as string;
        text += joinedText(value);
      } else reached = appendParts(out!, reached, $call<unknown>(endCallback, endThis, value, index, array));
    }
    break;
  }

  const passed = thirdLink === linkFilter ? passedThird : secondLink === linkFilter ? passedSecond : passedFirst;
  if (endKind === endFlatMap) return $truncateNewArray<unknown>(out!, reached);
  if (out !== undefined) return isDense ? $truncateNewArray<unknown>(out, passed) : out;
  if (endKind === endLength) return isDense ? passed : count;
  if (endKind === endReduce) return finishReduce(hasAccumulator, accumulator);
  if (endKind === endJoin) return finishJoin(text, operand as string, reached, isDense ? reached + 1 : count);
  return endKind === endSome ? false : endKind === endEvery ? true : endKind === endFindIndex ? -1 : undefined;
}
