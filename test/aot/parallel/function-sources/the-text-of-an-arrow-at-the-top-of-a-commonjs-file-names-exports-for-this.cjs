// In a CommonJS file `this` at the top is `exports`, and `bun run` writes that name: where the text is evaluated again nothing binds it.
const held = () => this;
const again = (0, eval)("(" + held + ")");
try {
  console.log(again() === globalThis);
} catch (error) {
  console.log(error.name);
}
console.log(held() === exports, new Function("exports", "return (" + held + ")")(5)());
