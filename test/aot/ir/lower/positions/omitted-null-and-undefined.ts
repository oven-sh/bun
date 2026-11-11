// RUN(FIELDS): link
// FIELDS: layout {{*}}{key="either" declared={type=undefined|null|string} {{*}}{key="label" declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} {{*}}{key="next" declared={type=undefined|null|[[item]] flags=[OmitsUndefined]} {{*}}{key="note" declared={type=undefined|null|string flags=[OmitsNull]}

// RUN: lower
// The functions come in the order of their names.
// CHECK: name="both" {{*}}parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}]
// CHECK: name="holdsNeither" {{*}}parameters=[{type=number}] results=[{type=number}]
// CHECK: name="read" {{*}}parameters=[{type=undefined|null|[[item]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}]
// CHECK: name="saysBoth" {{*}}parameters=[{type=undefined|null|string}] results=[{type=undefined|null|string}]
// CHECK: name="saysNothing" {{*}}parameters=[{type=anything}, {type=anything}, {type=anything}]
// CHECK: name="saysNull" {{*}}parameters=[{type=undefined|null|[[item]] flags=[OmitsUndefined]}] results=[{type=undefined|null|[[item]] flags=[OmitsUndefined]}]
// CHECK: name="saysUndefined" {{*}}parameters=[{type=undefined|null|string flags=[OmitsNull]}] results=[{type=undefined|null|string flags=[OmitsNull]}]
// CHECK: name="saysWhatBoundSays" {{*}}parameters=[{type=undefined|null|[[item]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[item]] flags=[OmitsUndefined]}]

interface Item {
  label: string;
  next: Item | null;
  note?: string;
  either: string | null | undefined;
  count: number;
  anything: any;
}

export function both(label: string): string {
  return label;
}

export function saysNull(next: Item | null): Item | null {
  return next;
}

export function saysUndefined(note?: string): string | undefined {
  return note;
}

export function saysBoth(either: string | null | undefined): string | null | undefined {
  return either;
}

export function holdsNeither(count: number): number {
  return count;
}

export function saysNothing<T>(anything: any, unknown: unknown, variable: T) {
  return [anything, unknown, variable];
}

// Whatever a call puts in the place of a type parameter fits the bound, so it lists no more than the bound does.
export function saysWhatBoundSays<B extends Item, N extends Item | null>(bounded: B, orNull: N) {
  return [bounded, orNull];
}

export function read(item: Item) {
  return item.label;
}

export function take(value: unknown) {
  return read(value as Item);
}
