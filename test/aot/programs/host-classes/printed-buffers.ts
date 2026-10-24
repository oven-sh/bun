// console.log calls Buffer.prototype.inspect for a Buffer, as for any object with a method under Symbol.for("nodejs.util.inspect.custom").
const custom = Symbol.for("nodejs.util.inspect.custom");
const buffer = Buffer.from("abc");
console.log(buffer);
console.log([buffer], { buffer });
console.log(Buffer.alloc(0), Buffer.alloc(60, 1));
const withMore = Object.assign(Buffer.from("a"), { more: { a: [1, "b"] }, text: "c" });
console.log(withMore);
Object.defineProperty(withMore, "hidden", { value: 1, enumerable: false });
console.log(withMore);
console.log(Bun.inspect(buffer), Bun.inspect(withMore));
console.log((Buffer.prototype as any)[custom] === (Buffer.prototype as any).inspect, (buffer as any).inspect(), (buffer as any)[custom](0, {}), (buffer as any)[custom](0, { showHidden: true }));
console.log((withMore as any)[custom](0, { showHidden: true }), (withMore as any)[custom](0), (withMore as any)[custom](0, null));
const parsed: unknown = JSON.parse(process.argv[2] ?? '{"a":1}');
console.log(parsed, process.argv.length > 5 ? parsed : buffer);
class Own {
  [custom](depth: number, options: { stylize: Function; depth: number; colors: boolean }, inspect: Function) {
    return `own ${depth} ${typeof options.stylize} ${options.colors} ${typeof inspect} ${inspect({ a: 1 })}`;
  }
}
console.log(new Own(), [new Own()]);
