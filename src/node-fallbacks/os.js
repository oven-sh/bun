/**
 * Browser polyfill for the `"os"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */

import os from "os-browserify/browser";
export default os;
export var {
  endianness,
  hostname,
  loadavg,
  uptime,
  freemem,
  totalmem,
  cpus,
  type,
  release,
  arch,
  platform,
  tmpdir,
  EOL,
  homedir,
  networkInterfaces,
  getNetworkInterfaces,
} = os;
