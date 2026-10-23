// BUN_JSC_useExplicitResourceManagement=0 takes the global DisposableStack away. The types of the program still name the class, and code tests values against them.
function isDisposed(stack: DisposableStack | undefined): string {
  return stack === undefined ? "none" : String(stack.disposed);
}
function make(): DisposableStack | undefined {
  return typeof DisposableStack === "function" ? new DisposableStack() : undefined;
}
function isStack(value: unknown): value is DisposableStack {
  return typeof DisposableStack !== "undefined" && value instanceof DisposableStack;
}
let line = "";
for (let round = 0; round < 300; round++) line = isDisposed(make()) + " " + isStack({}) + " " + isStack(make());
console.log(line);
