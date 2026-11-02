// A walk written in JavaScript asks for the descriptor of every own property of `process`. That makes the values that Bun creates on first use, all of them.
function walk(value, depth, seen) {
  if (depth === 0 || value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return 1;
  seen.add(value);
  let count = 1;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) count += walk(descriptor.value, depth - 1, seen);
  }
  return count;
}
console.log(walk(process, 2, new Set()) > 10);
