function family() {
  return Promise.resolve(familySync());
}
function familySync() {
  return null;
}
function versionAsync() {
  return Promise.resolve(version());
}
function version() {
  return null;
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

//# debugId=A85DFA4F9EB266FA64756e2164756e21
