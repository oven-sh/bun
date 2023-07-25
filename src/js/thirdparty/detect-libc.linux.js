// Hardcoded module "detect-libc" for linux
function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return GLIBC;
}

const GLIBC = "glibc";
const MUSL = "musl";

function versionAsync() {
  return Promise.resolve(version());
}

function version() {
  return "2.29";
}

function isNonGlibcLinuxSync() {
  return false;
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
  versionAsync,
};
