// What a program writes to make a list of a given length, or out of another list.
// The compiler walks each maker at its call, with the mapper in the loop. So each has one loop and calls its mapper at one place.
// The list is made once, with its length and with storage for what it comes to hold.
// A store that the list does not take leaves the loop, which is entered anew: what the loop knows of a list it has from in front of itself.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare var $overriddenName: string;
declare function $newArrayLike<T>(n: number, a: unknown[] | undefined): T[];
declare function $tryPutByValDirect(out: unknown[], k: number, value: unknown): boolean;
// Every place of a list that this file has just made, in a row. False, with nothing stored, where its storage does not take any value.
declare function $tryFillNewArray(out: unknown[], value: unknown): boolean;
declare function $truncateNewArray<T>(out: T[], n: number): T[];
declare function $isJSArray(value: unknown): boolean;

// Array(length) throws where the length is a number that no list can have. What the program evaluates behind it comes behind this.
$visibility = "Private";
export function checkedArrayLength(length: unknown): unknown {
  if (typeof length === "number" && (length | 0) === length && length >= 0) return length;
  new Array<unknown>(length as number);
  return length;
}

// Array.from({ length }, mapper). A stack trace that the mapper takes lists Array.from.
$overriddenName = "from";
export function arrayFromLength(length: unknown, mapper: unknown): unknown[] {
  if (typeof length === "number" && typeof mapper === "function") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = $newArrayLike<unknown>(count, undefined);
      let index = 0;
      entered: for (;;) {
        for (; index < count; index++) {
          const item: unknown = mapper(undefined, index);
          const isStored: boolean = $tryPutByValDirect(made, index, item);
          if (!isStored) {
            made[index] = item;
            index = (index + 1) >>> 0;
            continue entered;
          }
        }
        break;
      }
      return made;
    }
  }
  const items = { length } as ArrayLike<undefined>;
  return Array.from(items, mapper as (value: undefined, index: number) => unknown);
}

// Array.from(list, mapper), where a spread of `list` runs nobody's code. That holds of a plain Set too, which goes the way of anything else.
// The iterator of a list hands out what lies at each index, a hole as undefined, for as long as the list is that long: the mapper may make it longer or shorter.
$overriddenName = "from";
export function arrayFromList(list: unknown, mapper: unknown): unknown[] {
  if ($isJSArray(list) && typeof mapper === "function") {
    const source = list as unknown[];
    const count = source.length;
    const made = $newArrayLike<unknown>(count, undefined);
    let index = 0;
    entered: for (;;) {
      for (; index < source.length; index++) {
        const item: unknown = mapper(source[index], index);
        const isStored: boolean = $tryPutByValDirect(made, index, item);
        if (!isStored) {
          made[index] = item;
          index = (index + 1) >>> 0;
          continue entered;
        }
      }
      break;
    }
    return index === count ? made : $truncateNewArray<unknown>(made, index);
  }
  return Array.from(list as Iterable<unknown>, mapper as (value: unknown, index: number) => unknown);
}

// Array.from({ length })
$visibility = "Private";
export function arrayOfUndefined(length: unknown): undefined[] {
  if (typeof length === "number") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = $newArrayLike<undefined>(count, undefined);
      if ($tryFillNewArray(made, undefined)) return made;
      let index = 0;
      entered: for (;;) {
        for (; index < count; index++) {
          const isStored: boolean = $tryPutByValDirect(made, index, undefined);
          if (!isStored) {
            made[index] = undefined;
            index = (index + 1) >>> 0;
            continue entered;
          }
        }
        break;
      }
      return made;
    }
  }
  const items = { length } as ArrayLike<undefined>;
  return Array.from(items) as undefined[];
}

// Array(length).fill(value)
$visibility = "Private";
export function filledArray(length: unknown, value: unknown): unknown[] {
  if (typeof length === "number") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = $newArrayLike<unknown>(count, undefined);
      if ($tryFillNewArray(made, value)) return made;
      let index = 0;
      entered: for (;;) {
        for (; index < count; index++) {
          const isStored: boolean = $tryPutByValDirect(made, index, value);
          if (!isStored) {
            made[index] = value;
            index = (index + 1) >>> 0;
            continue entered;
          }
        }
        break;
      }
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  made.fill(value);
  return made;
}

// Array(length).fill(value).map(mapper), where the mapper does not take the list and checkedArrayLength has passed the length.
// A stack trace that the mapper takes lists map.
$overriddenName = "map";
export function mappedFilledArray(length: unknown, value: unknown, mapper: unknown): unknown[] {
  if (typeof length === "number" && typeof mapper === "function") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = $newArrayLike<unknown>(count, undefined);
      let index = 0;
      entered: for (;;) {
        for (; index < count; index++) {
          const item: unknown = mapper(value, index);
          const isStored: boolean = $tryPutByValDirect(made, index, item);
          if (!isStored) {
            made[index] = item;
            index = (index + 1) >>> 0;
            continue entered;
          }
        }
        break;
      }
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  return made.fill(value).map(mapper as (value: unknown, index: number) => unknown);
}
