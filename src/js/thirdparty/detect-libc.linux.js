// Hardcoded module "detect-libc" for linux

const is_glibc = process.report.getReport().header.glibcVersionCompiler !== undefined;

function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return is_glibc ? GLIBC : MUSL;
}

const GLIBC = "glibc";
const MUSL = "musl";

function version() {
  return Promise.resolve(versionSync());
}

function versionSync() {
  return is_glibc ? "2.29" : "1.2.5";
}

function isNonGlibcLinuxSync() {
  return !is_glibc;
}

function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}

export default {
  GLIBC,
  MUSL,
  family,
  familySync,
  isNonGlibcLinux,
  isNonGlibcLinuxSync,
  version,
  versionSync,
};
