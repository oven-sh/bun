declare function $arrayStorageKind(a: unknown[]): number;
declare const $arrayStorageInt32: number;
declare const $arrayStorageDouble: number;
declare const $arrayStorageContiguous: number;
declare function $getDoubleIndex(a: unknown[], k: number): number;
declare function $hasContiguousIndex(a: unknown[], k: number): boolean;
declare function $getContiguousIndex<T>(a: unknown[], k: number): T;

function firstSearchedIndex(fromIndex: number | undefined, length: number): number {
  if (fromIndex === undefined) return 0;
  if (fromIndex >= 0) return (fromIndex < length ? fromIndex : length) >>> 0;
  const distanceFromEnd = -fromIndex;
  return distanceFromEnd >= 1 && distanceFromEnd < length ? (length - (distanceFromEnd >>> 0)) >>> 0 : 0;
}

function holdsBoxedValues(kind: number): boolean {
  return kind === $arrayStorageContiguous || kind === $arrayStorageInt32;
}

function indexOfUndefined(array: unknown[], index: number, length: number): number {
  for (; index < length; index++) {
    const has: boolean = $hasContiguousIndex(array, index);
    if (has && $getContiguousIndex<unknown>(array, index) === undefined) return index;
  }
  return -1;
}

export function indexOf(this: unknown[], searched: unknown, fromIndex: number | undefined): number {
  const length = this.length >>> 0;
  let index = firstSearchedIndex(fromIndex, length);
  const kind = $arrayStorageKind(this);
  if (kind === $arrayStorageDouble) {
    if (typeof searched !== "number") return -1;
    for (; index < length; index++) {
      if ($getDoubleIndex(this, index) === searched) return index;
    }
    return -1;
  }
  if (holdsBoxedValues(kind)) {
    if (searched === undefined) return indexOfUndefined(this, index, length);
    for (; index < length; index++) {
      if ($getContiguousIndex<unknown>(this, index) === searched) return index;
    }
    return -1;
  }
  for (; index < length; index++) {
    if (index in this && this[index] === searched) return index;
  }
  return -1;
}

function includesNaN(array: unknown[], index: number, length: number): boolean {
  for (; index < length; index++) {
    const element = array[index];
    if (element !== element) return true;
  }
  return false;
}

export function includes(this: unknown[], searched: unknown, fromIndex: number | undefined): boolean {
  const length = this.length >>> 0;
  let index = firstSearchedIndex(fromIndex, length);
  const kind = $arrayStorageKind(this);
  if (kind === $arrayStorageDouble) {
    if (searched === undefined) {
      for (; index < length; index++) {
        const element: number = $getDoubleIndex(this, index);
        if (element !== element) return true;
      }
      return false;
    }
    if (typeof searched !== "number") return false;
    for (; index < length; index++) {
      if ($getDoubleIndex(this, index) === searched) return true;
    }
    return false;
  }
  if (searched !== searched) return kind !== $arrayStorageInt32 && includesNaN(this, index, length);
  if (holdsBoxedValues(kind)) {
    for (; index < length; index++) {
      if ($getContiguousIndex<unknown>(this, index) === searched) return true;
    }
    return false;
  }
  for (; index < length; index++) {
    if (this[index] === searched) return true;
  }
  return false;
}
