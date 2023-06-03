function family() {
  return Promise.resolve(familySync());
}
function familySync() {
  return GLIBC;
}
function versionAsync() {
  return Promise.resolve(version());
}
function version() {
  return "2.29";
}
function isNonGlibcLinuxSync() {
  return !1;
}
function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}
var GLIBC = "glibc", MUSL = "musl";
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
<<<<<<< HEAD:src/js/out/modules/thirdparty/detect-libc.linux.js
=======

//# debugId=5524F79B22A4C88A64756e2164756e21
>>>>>>> 5e7ff00ef (hardcoded):src/js/out/modules_dev/thirdparty/detect-libc.js
