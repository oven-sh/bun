if (process.argv.length > 2) process.exit(0);
const child = Bun.spawn([process.execPath, process.argv[1], "child"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
child.send("word", error => console.log(error.code));
