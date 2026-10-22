const TypedArray = Object.getPrototypeOf(Uint8Array);
try {
  new TypedArray();
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(new Uint8Array(1) instanceof TypedArray, TypedArray.name);
