const child = Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $MADE_UP_WORD"], env: { ...process.env, MADE_UP_WORD: "carried" } });
console.log(child.stdout.toString().trim(), child.exitCode, child.success);
console.log(Bun.inspect(process.env).length > 2, structuredClone({ ...process.env }).PATH === process.env.PATH, Object.entries(process.env).every(([name, value]) => typeof name === "string" && typeof value === "string"));
