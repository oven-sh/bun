const child = Bun.spawnSync(["true"]);
console.log(child.exitCode, child.success, typeof child.stdout, child.stdout.length, child.constructor === Object);
