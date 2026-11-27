const attempt = (run: () => unknown): string => { try { return String(run()); } catch (e) { return (e as Error).constructor.name; } };
class Base {
  static kind = "a field of Base";
  static make(): string { return "made by Base"; }
  static get sign(): string { return "sign of Base"; }
  hello(): string { return "hello of Base"; }
}
const bare = JSON.parse("false") as boolean;
class Child extends ((bare ? null : Base) as unknown as typeof Base) {
  static own(): string { return "own"; }
}
console.log(attempt(() => Child.make()), attempt(() => Child.kind), attempt(() => Child.sign), attempt(() => new Child().hello()));
export {};
