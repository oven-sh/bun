// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const helper = [1, 2, 3].values().map(n => n);
helper.next();
console.log(helper.return().done);
