// Species: px ice. It prints what plain Bun prints.
class Safe {
  #code = 42;
  static codeOf(safe: Safe): number {
    return safe.#code;
  }
}
const other: Safe = JSON.parse("{}");
console.log(Safe.codeOf(new Safe()));
try {
  console.log(Safe.codeOf(other));
} catch (error) {
  console.log(error instanceof TypeError);
}
export {};
