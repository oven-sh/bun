const attempt = (run: () => unknown): string => { try { return String(run()); } catch (e) { return (e as Error).constructor.name; } };
class Base {
  static kind = "a field of Base";
  static make(): string { return "made by Base"; }
  static get sign(): string { return "sign of Base"; }
  hello(): string { return "hello of Base"; }
}
const bare = JSON.parse("true") as boolean;
class Child extends ((bare ? null : Base) as unknown as typeof Base) {
  static own(): string { return "own"; }
}
let sum = 0;
for (let i = 0; i < 300; i++) { try { sum += Child.make().length; } catch { sum += 1; } }
console.log(sum);
export {};
