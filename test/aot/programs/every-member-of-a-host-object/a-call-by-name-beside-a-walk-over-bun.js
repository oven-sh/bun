// The call hands Bun to native code as its receiver, and the store may have hit the global of that name. The walk still reads every member of Bun, `$` among them, whose first read runs code of the library.
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const members = [];
for (const key of Object.keys(Bun)) members.push(Bun[key]);
console.log(members.length > 10, typeof members[Object.keys(Bun).indexOf("$")]);
console.log(Bun.spawnSync((process.platform === "win32" ? ["cmd", "/c", "echo x"] : ["/bin/echo", "x"])).exitCode);
