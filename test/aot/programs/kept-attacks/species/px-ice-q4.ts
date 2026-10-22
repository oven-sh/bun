// A static method with a typed parameter returns a private field of it. Through `any` it also gets an object from JSON.parse, a literal, null and undefined: each of those reads throws a TypeError, as in plain Bun.
class Safe {
  #code = 42;
  static codeOf(safe: Safe): number {
    return safe.#code;
  }
}

const parsed: Safe = JSON.parse("{}");
const others: any[] = [new Safe(), parsed, {}, null, undefined];
console.log(Safe.codeOf(new Safe()));
for (const other of others) {
  try {
    console.log(Safe.codeOf(other));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}

export {};
