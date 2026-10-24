// Species: px ice. It prints what plain Bun prints.
class Safe {
  #code = 42;
  static codeOf(safe: Safe): number {
    return safe.#code;
  }
}
const list: any[] = [new Safe(), {}];
console.log(Safe.codeOf(new Safe()));
for (const other of list) {
  try {
    console.log(Safe.codeOf(other));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
export {};
