// RUN: lower
// OPTIONS: builtin-modules

// Members of bun hash by a spread between other members.
console.log("a spread between other members", Object.values({ first: 1, ...Bun.hash, last: () => 2 }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());

// GENERATED: last
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
