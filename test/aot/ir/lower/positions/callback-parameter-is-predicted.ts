// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|Array<undefined|null|[[item]]> flags={{*}}}]
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: parameters=[{type=undefined|null|[[item]] flags={{*}}}]

interface Item {
  price: number;
}

export function f(items: Item[]) {
  return items.map(item => item.price);
}
