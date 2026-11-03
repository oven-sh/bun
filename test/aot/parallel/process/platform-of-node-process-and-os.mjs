// node:process and node:os say what the platform is, before and after process.platform is assigned.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import os from "node:os";
import processModule, { arch, platform } from "node:process";
function show(when) {
  console.log(when + ": " + [platform, arch, processModule.platform, processModule.arch, processModule === process, os.platform(), os.arch(), process.release.name].join(" | "));
}
show("before");
process.platform = "made up";
process.arch = "made up";
show("after");
