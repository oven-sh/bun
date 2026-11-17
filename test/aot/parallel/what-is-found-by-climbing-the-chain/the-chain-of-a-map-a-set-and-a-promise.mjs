for (const subject of [new Map([[1, 2]]), new Set([3]), Promise.resolve(4), [5], new Error("six"), /seven/]) {
  let holder = subject, steps = 0;
  while (Object.getPrototypeOf(holder)) { holder = Object.getPrototypeOf(holder); steps++; }
  const first = Object.getPrototypeOf(subject);
  const names = Object.getOwnPropertyNames(first).filter(name => typeof Object.getOwnPropertyDescriptor(first, name).value === "function");
  console.log(steps, holder === Object.prototype, names.length > 1, typeof first[names[1]]);
}
const found = Object.getOwnPropertyDescriptor(Object.getPrototypeOf([new Map(), new Set()][JSON.parse("1")]), "forEach").value;
found.call(new Set([8]), value => console.log(value));
