// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function add(a, b) {
  return this.base + a + b;
}
console.log(add.apply({ base: 1 }, [2, 3]));
