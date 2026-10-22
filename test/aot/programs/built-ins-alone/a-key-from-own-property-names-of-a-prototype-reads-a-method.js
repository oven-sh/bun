class Box {
  double(value) {
    return value * 2;
  }
}
const box = new Box();
for (const key of Object.getOwnPropertyNames(Box.prototype)) {
  if (key !== "constructor") console.log(key, box[key](1.5));
}
