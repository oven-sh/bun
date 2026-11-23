const child = Bun.spawn([process.execPath, "--version"], { env: { ...process.env, BUN_BE_BUN: "1" } });
console.log((await new Response(child.stdout).text()).length > 0, await child.exited);

export {};
