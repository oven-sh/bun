// src/js/thirdparty/detect-libc.js
function family() {
  return Promise.resolve(familySync());
}
function familySync() {
  if (false) {
  } else {
    return null;
  }
}
function versionAsync() {
  return Promise.resolve(version());
}
function version() {
  if (false) {
  } else {
    return null;
  }
}
function isNonGlibcLinuxSync() {
  return false;
}
function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}
var GLIBC = "glibc";
var MUSL = "musl";
export {
  versionAsync,
  version,
  isNonGlibcLinuxSync,
  isNonGlibcLinux,
  familySync,
  family,
  MUSL,
  GLIBC
};

//# debugId=3A36AD02890BE70B64756e2164756e21
