// RUN(FIELDS): link
// FIELDS: layout {{*}}name="Item" {{*}}{key="either" declared={type=undefined|null|string} {{*}}{key="label" declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} {{*}}{key="next" declared={type=undefined|null|[[item]] flags=[OmitsUndefined]} {{*}}{key="note" declared={type=undefined|null|string flags=[OmitsNull]}

// RUN: lower
// The functions come in the order of their names.
// CHECK: name="both" {{*}}parameters=[{type=undefined|null|string site=[[s0]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[s1]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: name="holdsNeither" {{*}}parameters=[{type=number site=[[s2]]}] results=[{type=number site=[[s3]]}]
// CHECK: name="read" {{*}}parameters=[{type=undefined|null|[[item]] site=[[s4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[s5]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: name="saysBoth" {{*}}parameters=[{type=undefined|null|string site=[[s6]]}] results=[{type=undefined|null|string site=[[s7]]}]
// CHECK: name="saysNothing" {{*}}parameters=[{type=anything}, {type=anything}, {type=undefined|null|[[variable]] site=[[s8]]}]
// CHECK: name="saysNull" {{*}}parameters=[{type=undefined|null|[[item]] site=[[s9]] flags=[OmitsUndefined]}] results=[{type=undefined|null|[[item]] site=[[s10]] flags=[OmitsUndefined]}]
// CHECK: name="saysUndefined" {{*}}parameters=[{type=undefined|null|string site=[[s11]] flags=[OmitsNull]}] results=[{type=undefined|null|string site=[[s12]] flags=[OmitsNull]}]

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

export function read(item: Item) {
  return item.label;
}

export function take(value: unknown) {
  return read(value as Item);
}
