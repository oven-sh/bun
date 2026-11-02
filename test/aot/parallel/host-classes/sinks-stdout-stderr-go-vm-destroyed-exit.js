// process.stdout and process.stderr are made and written through. At exit the VM is destroyed, and their sinks with it.
// Env: BUN_DESTRUCT_VM_ON_EXIT=1
// Env: BUN_JSC_useZombieMode=1
process.stdout.write("through process.stdout\n");
process.stderr.write("");
console.log(typeof process.stdout.write, typeof process.stderr.write);
