export const endianness = function () {
  return "LE";
};

export const hostname = function () {
  if (typeof location !== "undefined") {
    return location.hostname;
  } else return "";
};

export const loadavg = function () {
  return [];
};

export const uptime = function () {
  return 0;
};

export const freemem = function () {
  return Number.MAX_VALUE;
};

export const totalmem = function () {
  return Number.MAX_VALUE;
};

export const cpus = function () {
  return [];
};

export const type = function () {
  return "Browser";
};

export const release = function () {
  if (typeof navigator !== "undefined") {
    return navigator.appVersion;
  }
  return "";
};

export const getNetworkInterfaces = function () {
  return {};
};
export const networkInterfaces = getNetworkInterfaces;

export const arch = function () {
  return "javascript";
};

export const platform = function () {
  return "browser";
};

export const tmpdir = function () {
  return "/tmp";
};
export const tmpDir = tmpdir;

export const EOL = "\n";

export const homedir = function () {
  return "/";
};

// `import os from "node:os"` is how Node's CommonJS shape is usually reached.
// Without a default export the bundler fails the build with "doesn't have a
// matching export named default", so mirror the other fallbacks here.
export default {
  EOL,
  arch,
  cpus,
  endianness,
  freemem,
  getNetworkInterfaces,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  platform,
  release,
  tmpDir,
  tmpdir,
  totalmem,
  type,
  uptime,
};
