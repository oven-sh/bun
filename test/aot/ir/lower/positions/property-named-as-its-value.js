// RUN: link
void 0;
let a = 1;
globalThis.nothing({ a: a }, { "a": (a) }, { a: b }, { [a]: a }, { NaN: NaN });
// `a` stands for `a: a` and for `"a": (a)`.
// CHECK: textOfQuotes="globalThis.nothing({ a }, { a }, { a: b }, { [a]: a }, { NaN: NaN })"
