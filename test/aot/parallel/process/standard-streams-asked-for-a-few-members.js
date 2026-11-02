// A program that writes to its standard outputs and asks the three streams whether they are terminals, and for their descriptors, has none of node:stream, node:tty and node:fs in it.
// STATISTIC: ImageFunctionsEmitted <= 200
process.stdout.write("to the output\n");
process.stderr.write("to the errors\n");
console.log(process.stdout.isTTY === true, process.stderr.isTTY === true, process.stdin.isTTY === true);
console.log(process.stdout.fd, process.stderr.fd, process.stdin.fd);
console.log(typeof process.stdout, process.stdout === process.stdout, process.stdout === process.stderr);
