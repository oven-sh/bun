// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.stdout.write("out\n");
process.stderr.write("err\n");
console.log(process.stdout.fd, process.stderr.fd);
