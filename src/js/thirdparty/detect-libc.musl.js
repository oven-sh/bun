// Hardcoded module "detect-libc" for linux
function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return MUSL;
}

const GLIBC = "glibc";
const MUSL = "musl";

function version() {
  return Promise.resolve(versionSync());
}

function versionSync() {
  return "1.2.5";
}

function isNonGlibcLinuxSync() {
  return true;
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
