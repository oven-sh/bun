// Every member of Bun comes into unknown hands through a global, and text that is evaluated at run time counts them.
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const members = [];
for (const key of Object.keys(Bun)) members.push(Bun[key]);
globalThis.members = members;
console.log(new Function("return members.length > 10")());
const child = Bun.spawn((process.platform === "win32" ? ["cmd", "/c", "echo hello from the child"] : ["/bin/echo", "hello from the child"]), { stdio: ["ignore", "pipe", "pipe"], onExit(_child, exitCode) { console.log("exit", exitCode); } });
console.log((await new Response(child.stdout).text()).trim());
await child.exited;
