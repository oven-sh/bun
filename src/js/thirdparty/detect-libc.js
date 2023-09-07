// Hardcoded module "detect-libc" for darwin
function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return null;
}

const GLIBC = "glibc";
const MUSL = "musl";

function versionAsync() {
  return Promise.resolve(version());
}

function version() {
  return null;
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
