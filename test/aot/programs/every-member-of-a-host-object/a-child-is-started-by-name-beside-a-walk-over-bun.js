// The call of Bun.spawn may be a call of anything, because the store may have hit the global `Bun`: so Bun, its receiver, is in unknown hands. The walk above it still reads every member, `$` among them.
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const members = [];
for (const key of Object.keys(Bun)) members.push(Bun[key]);
console.log(members.length > 10, typeof members[Object.keys(Bun).indexOf("$")]);
const child = Bun.spawn((process.platform === "win32" ? ["cmd", "/c", "echo hello from the child"] : ["/bin/echo", "hello from the child"]), { stdio: ["ignore", "pipe", "pipe"] });
console.log((await new Response(child.stdout).text()).trim());
