function second(first, value) {
  return typeof value + " " + String(value);
}

console.log(second.call(undefined, 1, "text"));
console.log(second.call(undefined, 1, 2.5));
console.log(second.call(undefined, 1));
