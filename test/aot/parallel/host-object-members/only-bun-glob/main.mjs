// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const glob = new Bun.Glob("*.txt");
console.log([...glob.scanSync(".")].sort().join());
const found = [];
for await (const file of glob.scan(".")) found.push(file);
console.log(found.sort().join());
