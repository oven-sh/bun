// A private method that is read by name is searched for among the methods of its class once, not at every read. The program counts how often the run time is asked for it.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
let evaluated = 0;
function argument(): number {
  evaluated++;
  return 1;
}
class Pool {
  total = 0;
  #add(amount: number): number {
    this.total += amount;
    return this.total;
  }
  add(): number {
    return this.#add(argument());
  }
}
const Untyped: any = Pool;
class Heir extends Untyped {}
const taken: any[] = [new Heir(), new Pool()];
const pool = taken[1] as Pool;
for (let turn = 0; turn < 2000; turn++) pool.add();
const searches = counted ? counted("operationAOTPrivateGet") : null;
console.log(pool.total, evaluated, searches === null || searches < 10);
