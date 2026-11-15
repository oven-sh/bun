console.log(console._stdout === process.stdout, console._stderr === process.stderr);
console._stdout.write("by the console's name\n");
console.log(console._stdout.writable);
