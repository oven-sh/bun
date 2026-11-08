// RUN: link
// CHECK: layout {{*}}name="Label"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[cell]]]
// CHECK: layout [[cell]] {{*}}fields=[{key="value"

// Every instantiation of Cell has one layout, so the cast has the position that `first` made for `Cell<number> | Other`. A Label is no `Cell<number>`:
// the checker is asked about the type that the cast writes.
interface Cell<T> {
  value: T;
}

interface Other {
  other: number;
}

class Label {
  size = 1;
  value = "";
}

export function first(cell: Cell<number> | Other) {
  return cell;
}

export function pick(x: Label | Other) {
  return x as Cell<string> | Other;
}

export const picked = pick(new Label());
