// `scope.run(task, this, ...values)` in a function whose rest parameter is named by that spread alone: the callee is entered directly and takes the list as its own rest list.
class Scope {
  depth = 0;
  run(task: (...values: unknown[]) => unknown, receiver: unknown, ...values: unknown[]): unknown {
    this.depth++;
    try { return task.apply(receiver, values); } finally { this.depth--; }
  }
}
function wrap(scope: Scope, task: (...values: unknown[]) => unknown) {
  return function (this: unknown, ...values: unknown[]) { return scope.run(task, this, ...values); };
}
const scope = new Scope();
function add(this: { base: number }, a: number, b = 10, ...more: number[]): number { return this.base + a + b + more.length + scope.depth * 1000; }
const holder = { base: 100, add: wrap(scope, add as (...values: unknown[]) => unknown) };
let total = 0;
for (let i = 0; i < 1000; i++) total += (holder.add(i & 7, 1) as number) + (holder.add(i & 3) as number) + (holder.add(1, 2, 3, 4, 5) as number);
console.log(total, scope.depth, holder.add(), holder.add(undefined, undefined, undefined));
