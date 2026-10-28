// process.stdout and process.stderr are made and written through. At exit the VM is destroyed, and their sinks with it.
process.stdout.write("through process.stdout\n");
process.stderr.write("");
console.log(typeof process.stdout.write, typeof process.stderr.write);
