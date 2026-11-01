// RUN: link
// CHECK: data {{*}}members=[{key="a" value=Number{value=3}}, {key="b" value=Number{value=2}}, {key="c1" value=Number{value=4}}, {key="5" value=Number{value=5}}, {key="__proto__" value=Number{value=6}}, {key="true" value=Number{value=7}}]

export const keys = { a: 1, b: 2, a: 3, ["c" + 1]: 4, 5: 5, ["__proto__"]: 6, [true]: 7 };
