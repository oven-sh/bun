// The arms share the fields `value` and `yes`, so that each read of `kind` may see a number, a text, a list or nothing.
type Expression =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "not"; readonly value: Expression }
  | { readonly kind: "sum"; readonly left: Expression; readonly right: Expression }
  | { readonly kind: "choice"; readonly test: Expression; readonly yes: Expression; readonly no: Expression };
type Statement =
  | { readonly kind: "if"; readonly test: Expression; readonly yes: readonly Statement[]; readonly no: readonly Statement[] | null }
  | { readonly kind: "add"; readonly value: Expression };
let steps = 0;
let total = 0;
function evaluate(node: Expression): number {
  steps++;
  switch (node.kind) {
    case "number": return node.value;
    case "text": return node.value.length;
    case "not": return evaluate(node.value) === 0 ? 1 : 0;
    case "sum": return evaluate(node.left) + evaluate(node.right);
    case "choice": return evaluate(node.test) !== 0 ? evaluate(node.yes) : evaluate(node.no);
  }
}
function run(list: readonly Statement[]): void {
  for (const node of list) {
    switch (node.kind) {
      case "if": if (evaluate(node.test) !== 0) run(node.yes); else if (node.no !== null) run(node.no); break;
      case "add": total = (total + evaluate(node.value)) % 1000003; break;
    }
  }
}
function expression(n: number): Expression {
  switch (n % 5) {
    case 0: return { kind: "number", value: n };
    case 1: return { kind: "text", value: "t".repeat(n % 9) };
    case 2: return { kind: "not", value: expression(n >> 1) };
    case 3: return { kind: "sum", left: expression(n - 1), right: expression(n >> 2) };
    default: return { kind: "choice", test: expression(n >> 1), yes: expression(n - 2), no: expression(n >> 3) };
  }
}
function statement(n: number): Statement {
  return n % 3 === 0 && n > 0 ? { kind: "if", test: expression(n), yes: [statement(n - 1), statement(n >> 1)], no: n & 4 ? [statement(n - 2)] : null } : { kind: "add", value: expression(n) };
}
for (let n = 0; n < 60; n++) run([statement(n), statement(n * 7)]);
console.log(total, steps);
function kindOf(value: any): string { return String(value.kind) + typeof value.other; }
const values: any[] = [1, 1.5, "t", true, Symbol.iterator, 10n, [1], new Map(), /a/, new Date(0), { kind: "record" }, () => 1];
console.log(values.map(kindOf).join());
(Number.prototype as any).other = 5;
(Array.prototype as any).last = 7;
console.log(values.map(kindOf).join(), values.map(value => typeof value.last).join());
export {};
