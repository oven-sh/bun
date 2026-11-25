// Decorators run with the code around the class that they are written at.
const keep = (value: any, context: any): any => undefined;
function change(parts: string[]) {
  parts[0] = "(function () { return 2; })";
  return keep;
}
function ofDeclaration(): number { const parts = ["(function () { return 1; })"]; @(change(parts)) class C {} return eval(parts[0]!)(); }
function ofExpression(): number { const parts = ["(function () { return 1; })"]; const C = @(change(parts)) class {}; return eval(parts[0]!)(); }
function ofMethod(): number { const parts = ["(function () { return 1; })"]; class C { @(change(parts)) method() {} } return eval(parts[0]!)(); }
function evaluated(text: string): number { let local = 1; @(eval(text)) class C {} return eval("(function () { return local; })")(); }
function evaluatedOfExpression(text: string): number { let local = 1; const C = @(eval(text)) class {}; return eval("(function () { return local; })")(); }
function evaluatedOfMethod(text: string): number { let local = 1; class C { @(eval(text)) method() {} } return eval("(function () { return local; })")(); }
console.log(ofDeclaration(), ofExpression(), ofMethod());
console.log(evaluated("local = 5, keep"), evaluatedOfExpression("local = 6, keep"), evaluatedOfMethod("local = 7, keep"));
function spread(local: number): number { const parts = ["(function () { var await = 1; return local + await; })"] as const; return eval(...(parts as any as [string]))(); }
console.log(spread(8));
export {};
