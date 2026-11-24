// An await of `import()` calls the `then` that the file exports, on the namespace. A `then` that can read `this` finds every export there, so the file lists them all.
// An arrow function cannot, and its file lists the names that are read and no others.
// RUN: link
// CHECK: path="{{*}}/reads-this.mjs"{{*}}exports=[{name="a" variable=[[a]]}, {name="box" variable=[[box]]}, {name="then" variable=[[then]]}]
// RUN(ARROW): link
// ARROW: path="{{*}}/an-arrow.mjs"{{*}}exports=[{name="a" variable=[[a]]}, {name="then" variable=[[then]]}]

// FILE: main.mjs
const { a } = await import("./reads-this.mjs");
const { a: other } = await import("./an-arrow.mjs");
console.log(a, other);

// FILE: reads-this.mjs
export const a = 1;
export const box = { n: 1 };
export function then(resolve) {
  console.log(this.box === box);
  resolve({ a: 2 });
}

// FILE: an-arrow.mjs
export const a = 1;
export const box = { n: 1 };
export const then = resolve => resolve({ a: 2 });
