// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const order: string[] = [];
const convertible = {
  toString() {
    order.push("key converted");
    return "0";
  },
};
function keyOf(): any {
  order.push("key evaluated");
  return convertible;
}
function valueToStore(): number {
  order.push("value evaluated");
  return 5;
}
function storeIn(target: number[] | undefined): void {
  target![keyOf()] = valueToStore();
}
try {
  storeIn(undefined);
} catch (error) {
  console.log((error as Error).name);
}
console.log("a store to undefined, order: " + order.join());
export {};

/* Output:
TypeError
a store to undefined, order: key evaluated,value evaluated
*/
