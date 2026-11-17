// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += Reflect.get([turn], "map").call([turn], count => count + 1)[0];
console.log(sum);
