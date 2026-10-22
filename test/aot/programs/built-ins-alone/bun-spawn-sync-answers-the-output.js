const { stdout, exitCode, success } = Bun.spawnSync(["echo", "hello"]);
console.log(stdout instanceof Uint8Array, stdout.toString().length, exitCode + 1, success);
