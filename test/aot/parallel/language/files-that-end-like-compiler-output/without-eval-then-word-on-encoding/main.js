function f() {
  return 1;
}
console.log(String(f));
console.log(f());
// bun --aot: this file is not UTF-8: read as the runtime reads it
