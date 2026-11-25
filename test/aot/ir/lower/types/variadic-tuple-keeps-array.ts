// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|Array flags={{*}}}]

// Nobody knows what `...T` holds, so the type says nothing about the contents. It is still an array, and that is checked.
export function f<T extends unknown[]>(p: [string, ...T]) {}
