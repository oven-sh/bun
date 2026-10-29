// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const methods = [Array.prototype.filter];
console.log(methods[0].bind([1, 2, 3])(n => n > 1).length);
