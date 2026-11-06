// process.platform and process.arch are deleted between the reads.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const decoded = text => Buffer.from(text).toString(); // a string that is decoded at run time
function platformName() { return globalThis.process.platform; }
function archName() { return globalThis.process.arch; }
function isOne() { const host = process; return [host.platform === "linux", host.platform === "darwin", host.platform === "win32"].join(); }
function branch() {
  const { platform } = process;
  if (platform === "linux") return "the branch for Linux";
  if (platform === "darwin") return "the branch for macOS";
  if (platform === "win32") return "the branch for Windows";
  return "no branch";
}
function chosen() {
  const { platform } = process;
  switch (platform) {
    case "linux": return "the case for Linux";
    case "darwin": return "the case for macOS";
    case "win32": return "the case for Windows";
    case "made up": return "the case for the made-up platform";
    default: return "no case";
  }
}
function byPattern() { const { platform, arch } = process; return platform + "/" + arch; }
function inAChain() { return process?.platform + "/" + process?.arch; }
function byReflection() { return Reflect.get(process, "platform") + "/" + Reflect.get(process, "arch"); }
function byComputedName() { return process[decoded("platform")] + "/" + process[decoded("arch")]; }
globalThis.kept = [platformName, archName, isOne, branch, chosen];
function show(when) {
  console.log(when + ": " + [platformName(), archName(), isOne(), branch(), chosen(), byPattern(), inAChain(), byReflection(), byComputedName(), typeof globalThis.process.platform].join(" | "));
}
show("before");
show("before, again");
Reflect.deleteProperty(process, "platform"); delete globalThis.process.arch;
show("after");
show("after, again");
console.log(JSON.stringify([Object.getOwnPropertyDescriptor(process, "platform"), Object.getOwnPropertyDescriptor(process, "arch")]));
