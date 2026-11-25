function ask(what) { return typeof what.stdout.cork + " " + typeof what.stderr.once; }
process.stdout.write(ask(process.on("exit", () => {})) + "\n");
