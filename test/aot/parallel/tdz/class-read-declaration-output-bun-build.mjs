// @bun
// A class whose body calls nothing is read above its declaration, in a file with the first line that `bun build --target=bun` writes.
function show(value) {
  console.log(typeof value);
}
function attempt(read) {
  try {
    show(read());
  } catch (error) {
    console.log(error.name);
  }
}
function takeDefault(value = Late) {
  return value;
}
function readAll() {
  try {
    show(Late);
  } catch (error) {
    console.log(error.name);
  }
  try {
    console.log(typeof Late);
  } catch (error) {
    console.log(error.name);
  }
  try {
    show(new Late());
  } catch (error) {
    console.log(error.name);
  }
  try {
    show(Late.first);
  } catch (error) {
    console.log(error.name);
  }
  attempt(() => Late);
  attempt(takeDefault);
}
try {
  show(Late);
} catch (error) {
  console.log(error.name);
}
try {
  console.log(typeof Late);
} catch (error) {
  console.log(error.name);
}
readAll();
class Late {
  static first = 1;
  second = 2;
  method() {
    return this.second;
  }
}
readAll();
console.log(new Late().method());
