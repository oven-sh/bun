// A program has no `window`, and a read of it that nobody uses throws.
let arm = "server";
try {
  window;
  arm = "browser";
} catch (error) {
  console.log(error.name);
}
try {
  void window;
  arm = "browser";
} catch (error) {
  console.log(error.name);
}
const ask = () => window || 1;
try {
  ask();
  arm = "browser";
} catch (error) {
  console.log(error.name);
}
console.log(arm, typeof window);
