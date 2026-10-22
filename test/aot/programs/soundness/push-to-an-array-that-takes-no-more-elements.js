// Object.preventExtensions on an array: a push throws a TypeError and leaves the length as it was.
const closed = Object.preventExtensions([1, 2]);
try {
  console.log(closed.push(3));
} catch (error) {
  console.log(error.name);
}
console.log(closed.length);
