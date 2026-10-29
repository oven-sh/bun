// process.getuid and its ten siblings exist on every platform but Windows. Packages ask before they call.
const ask = (name, member, call) => console.log(name, typeof member, member ? typeof call() : "missing");
ask("getegid", process.getegid, () => process.getegid());
ask("geteuid", process.geteuid, () => process.geteuid());
ask("getgid", process.getgid, () => process.getgid());
ask("getgroups", process.getgroups, () => process.getgroups());
ask("getuid", process.getuid, () => process.getuid());
for (const [name, member] of [
  ["initgroups", process.initgroups],
  ["setegid", process.setegid],
  ["seteuid", process.seteuid],
  ["setgid", process.setgid],
  ["setgroups", process.setgroups],
  ["setuid", process.setuid],
])
  console.log(name, typeof member);
function isRoot() {
  return process.getuid && process.getuid() === 0;
}
function ownerOrMinusOne() {
  return process.getuid ? process.getuid() >= 0 : -1;
}
console.log(typeof isRoot(), ownerOrMinusOne());
console.log(typeof process.getuid?.(), typeof process.getgid?.());
console.log("getuid" in process, Object.hasOwn(process, "getuid"), Object.keys(process).includes("getuid"));
