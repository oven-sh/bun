// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|Array<undefined|null|[[item]]> site=w{{*}}}]
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: parameters=[{type=undefined|null|[[item]] site=w{{*}}}]

interface Item {
  price: number;
}

export function f(items: Item[]) {
  return items.map(item => item.price);
}
