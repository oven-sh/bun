// console.log() and Bun.inspect() hand util.inspect to a custom inspector, and URL and URLSearchParams print through it, in a program that never imports node:util.
const custom = Symbol.for("nodejs.util.inspect.custom");
type Inspect = (value: unknown, options?: object) => string;
class Money {
  cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  [custom](depth: number, options: { stylize: unknown; depth: number; colors: boolean }, inspect: Inspect): string {
    const nested = inspect({ list: [1, "two", new Map([[1, { three: 3n }]])], when: new Date(0), match: /x+/g }, { depth: 4 });
    return `Money<${inspect(this.cents / 100)}> ${depth} ${typeof options.stylize} ${options.colors} ${inspect.name} ${nested}`;
  }
}
console.log(new Money(1250));
console.log([new Money(1)], { deep: { deeper: new Money(2) } });
console.log(Bun.inspect(new Money(3)));
console.log(new URL("https://user:secret@example.com:8080/a/b?c=d&e=f#g"));
console.log(new URLSearchParams("a=1&b=2&a=3"));
console.log({ inner: new URLSearchParams() });
let first: unknown;
console.log({ [custom](_depth: number, _options: object, inspect: Inspect) { first = inspect; return "first"; } });
console.log({ [custom](_depth: number, _options: object, inspect: Inspect) { return inspect === first; } });
console.log({ [custom]() { return { plain: true }; } }, { [custom]: "no function" });
try {
  console.log({ [custom]() { throw new RangeError("thrown by the inspector"); } });
} catch (error) {
  console.log(String(error));
}
