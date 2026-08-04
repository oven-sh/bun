// Port of the cluster-facing helpers from Node v26.3.0
// lib/internal/util/inspector.js: detecting debug options in an execArgv and
// allocating consecutive inspector ports for forked workers.
const { validatePort } = require("internal/validators");

const kMinPort = 1024;
const kMaxPort = 65535;
const kInspectArgRegex = /--inspect(?:-brk|-port)?|--debug-port/;

function isUsingInspector(execArgv: string[] = process.execArgv) {
  // Node memoizes per execArgv array; this only runs on the cold fork path.
  for (let i = 0; i < execArgv.length; i++) {
    if (kInspectArgRegex.exec(execArgv[i]) !== null) return true;
  }
  return kInspectArgRegex.exec(process.env.NODE_OPTIONS!) !== null;
}

let debugPortOffset = 1;
function getInspectPort(inspectPort: number | (() => number) | null | undefined) {
  if (typeof inspectPort === "function") {
    inspectPort = inspectPort();
  } else if (inspectPort == null) {
    inspectPort = process.debugPort + debugPortOffset;
    if (inspectPort > kMaxPort) inspectPort = inspectPort - kMaxPort + kMinPort - 1;
    debugPortOffset++;
  }
  validatePort(inspectPort);

  return inspectPort;
}

export default {
  isUsingInspector,
  getInspectPort,
};
