/**
 * Internal platform detection utilities
 * Used by built-in modules to check the current platform
 */

const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isPosix = isMacOS || isLinux;

export default {
  isWindows,
  isMacOS,
  isLinux,
  isPosix,
};