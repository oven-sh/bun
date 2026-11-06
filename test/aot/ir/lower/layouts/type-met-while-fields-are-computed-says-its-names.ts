// RUN: link
// CHECK: layout [[nest]] name="Nest<number>" {{*}}fields=[{key="next" declared={type=undefined|null|[[nest]] flags=[OmitsNull]} flags=[{{*}}]}, {key="value" declared={type=number} flags=[{{*}}]}]

// RUN(PAIR): link
// PAIR: layout [[pair]] name="Even" {{*}}fields=[{key="other" declared={type=undefined|null|[[pair]] flags=[OmitsNull, OmitsUndefined]} flags=[{{*}}]}, {key="payload" declared={type=number} flags=[{{*}}]}]

// Of a type that is first met while the fields of a layout are computed a file says the names alone, also where the layout is the type's own: which types a file
// meets behind its code hangs on what it leaves to earlier files. `Odd` is met through `Even.other`: that `payload` holds a string is said where a value is converted
// to an `Odd` or an `Odd` is made. `Nest<Nest<number>>` is met through `Nest<number>.next`.
interface Nest<T> {
  value: T;
  next: Nest<Nest<T>> | undefined;
}

interface Even {
  other: Odd;
  payload: number;
}

interface Odd {
  other: Even;
  payload: string;
}

export function useNest(nest: Nest<number>) {
  return nest;
}

export function usePair(even: Even) {
  return even;
}

export function take(value: unknown) {
  return [useNest(value as Nest<number>), usePair(value as Even)];
}
