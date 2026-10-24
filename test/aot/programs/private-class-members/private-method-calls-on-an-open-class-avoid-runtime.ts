// A call of a private method on a class that also takes untyped objects does not look the method up by name. The program counts the entries of the operations that a lookup by name goes through.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entered(): number {
  return counted ? counted("operationAOTGetById") + counted("operationAOTGetByIdAndCache") : 0;
}
class Pool {
  served = 0;
  #next(): boolean {
    this.served++;
    return false;
  }
  #drain(): void {
    while (this.#next());
  }
  drain(): void {
    this.#drain();
  }
}
const Untyped: any = Pool;
class Heir extends Untyped {}
const taken: any[] = [new Heir(), new Pool()];
const pool = taken[1] as Pool;
pool.drain();
const before = entered();
for (let turn = 0; turn < 2000; turn++) pool.drain();
const entries = entered() - before;
console.log(pool.served, entries);
