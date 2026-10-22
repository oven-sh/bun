// `import { platform, arch } from "node:process"`: the names hold what process held when the module was loaded. A later store to process.platform does not reach them.
import { arch, platform } from "node:process";
const before = [platform, arch].join();
process.platform = "made up";
process.arch = "made up";
console.log([platform, arch].join() === before, platform === "made up", arch === "made up");
