// What a program writes to make a list of a given length.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";

// Array(length) throws where the length is a number that no list can have. What the program evaluates behind it comes behind this.
$visibility = "Private";
export function checkedArrayLength(length: unknown): unknown {
  if (typeof length === "number" && (length | 0) === length && length >= 0) return length;
  new Array<unknown>(length as number);
  return length;
}

// Array.from({ length }, mapper)
$visibility = "Private";
export function arrayFromLength(length: unknown, mapper: unknown): unknown[] {
  if (typeof length === "number" && typeof mapper === "function") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = new Array<unknown>(count);
      for (let index = 0; index < count; index++) made[index] = mapper(undefined, index);
      return made;
    }
  }
  const items = { length } as ArrayLike<undefined>;
  return Array.from(items, mapper as (value: undefined, index: number) => unknown);
}

// Array.from({ length })
$visibility = "Private";
export function arrayOfUndefined(length: unknown): undefined[] {
  if (typeof length === "number") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = new Array<undefined>(count);
      for (let index = 0; index < count; index++) made[index] = undefined;
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
      const made = new Array<unknown>(count);
      for (let index = 0; index < count; index++) made[index] = value;
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  return made.fill(value);
}

// Array(length).fill(value).map(mapper), where the mapper does not take the list
$visibility = "Private";
export function mappedFilledArray(length: unknown, value: unknown, mapper: unknown): unknown[] {
  if (typeof length === "number" && typeof mapper === "function") {
    const count = length | 0;
    if (count === length && count >= 0) {
      const made = new Array<unknown>(count);
      for (let index = 0; index < count; index++) made[index] = mapper(value, index);
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  return made.fill(value).map(mapper as (value: unknown, index: number) => unknown);
}
