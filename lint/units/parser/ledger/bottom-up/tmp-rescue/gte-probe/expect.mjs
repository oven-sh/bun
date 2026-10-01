const t = new Bun.Transpiler({ loader: "ts" });
// [new input, equivalent input that the installed bun accepts]
const rows = [
  ["type T = A extends [infer U extends B | C ? 1 : 2] ? 1 : 2;", "type T = any;"],
  ["let x: A extends keyof infer U extends B ? 1 : 2;", "let x: any;"],
  ["function f(keyof: any): keyof is string { return true }", "function f(keyof: any): boolean { return true }"],
  ["function f(readonly: any): readonly is string { return true }", "function f(readonly: any): boolean { return true }"],
  ["function f(infer: any): infer is string { return true }", "function f(infer: any): boolean { return true }"],
  ["function f(asserts: any): asserts is string { return true }", "function f(asserts: any): boolean { return true }"],
  ["function f(unique: any): unique is string { return true }", "function f(unique: any): boolean { return true }"],
  ["let f = (keyof: any): keyof is string => true", "let f = (keyof: any): boolean => true"],
  ["class C { m(keyof: any): keyof is string { return true } }", "class C { m(keyof: any): boolean { return true } }"],
  ["let x: asserts a;", "let x: any;"],
  ["let x: asserts a is string;", "let x: any;"],
  ["let x: asserts this;", "let x: any;"],
  ["let x: A | asserts B;", "let x: any;"],
  ["let x: (asserts A)[];", "let x: any;"],
  ["let x: keyof asserts B;", "let x: any;"],
  ["let v = x as asserts a;", "let v = x as any;"],
  ["let v = <asserts a>x;", "let v = <any>x;"],
  ["let x: unique A;", "let x: any;"],
  ["let x: unique keyof A;", "let x: any;"],
  ["let x: unique unique symbol;", "let x: any;"],
  ["let x: A.<B>;", "let x: any;"],
  ["let x: A.B.<C>;", "let x: any;"],
  ["let x: import('x')<A>;", "let x: any;"],
  ["let x: typeof import('x')<A>;", "let x: any;"],
  ["let x: import('x')<A>[];", "let x: any;"],
];
for (const [a, b] of rows) {
  let ra, rb;
  try { ra = "OK " + JSON.stringify(t.transformSync(a)); } catch (e) { ra = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  try { rb = JSON.stringify(t.transformSync(b)); } catch (e) { rb = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  console.log(JSON.stringify(a), "| now:", ra, "| expected:", rb);
}
