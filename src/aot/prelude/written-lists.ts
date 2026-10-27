// What a program writes to make a list of a given length.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare var $overriddenName: string;

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
      if (!count) return new Array<unknown>(0);
      let index = 0;
      let item = mapper(undefined, 0);
      let numbers: number[] | undefined;
      if (typeof item === "number") {
        numbers = new Array<number>(count);
        do {
          numbers[index] = item;
          if (++index === count) return numbers;
          item = mapper(undefined, index);
        } while (typeof item === "number");
      }
      const made = new Array<unknown>(count);
      if (numbers) for (let copied = 0; copied < index; copied++) made[copied] = numbers[copied];
      made[index] = item;
      for (index++; index < count; index++) made[index] = mapper(undefined, index);
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
      if (typeof value === "number") {
        const numbers = new Array<number>(count);
        for (let index = 0; index < count; index++) numbers[index] = value;
        return numbers;
      }
      const made = new Array<unknown>(count);
      for (let index = 0; index < count; index++) made[index] = value;
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  return made.fill(value);
}

// Array(length).fill(value).map(mapper), where the mapper does not take the list and checkedArrayLength has passed the length.
// A stack trace that the mapper takes lists map.
$overriddenName = "map";
export function mappedFilledArray(length: unknown, value: unknown, mapper: unknown): unknown[] {
  if (typeof length === "number" && typeof mapper === "function") {
    const count = length | 0;
    if (count === length && count >= 0) {
      if (!count) return new Array<unknown>(0);
      let index = 0;
      let item = mapper(value, 0);
      let numbers: number[] | undefined;
      if (typeof item === "number") {
        numbers = new Array<number>(count);
        do {
          numbers[index] = item;
          if (++index === count) return numbers;
          item = mapper(value, index);
        } while (typeof item === "number");
      }
      const made = new Array<unknown>(count);
      if (numbers) for (let copied = 0; copied < index; copied++) made[copied] = numbers[copied];
      made[index] = item;
      for (index++; index < count; index++) made[index] = mapper(value, index);
      return made;
    }
  }
  const made = new Array<unknown>(length as number);
  return made.fill(value).map(mapper as (value: unknown, index: number) => unknown);
}
