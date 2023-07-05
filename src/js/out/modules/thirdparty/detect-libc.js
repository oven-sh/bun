function version() {
  return Promise.resolve(libcVersion);
}
function versionSync() {
  return libcVersion;
}
function family() {
  return Promise.resolve(libcFamily);
}
function familySync() {
  return libcFamily;
}
function isNonGlibcLinux() {
  return Promise.resolve(libcFamily === "musl");
}
function isNonGlibcLinuxSync() {
  return libcFamily === "musl";
}
var {
  version: libcVersion,
  family: libcFamily
} = globalThis[Symbol.for("Bun.lazy")]("detect-libc"), GLIBC = "glibc", MUSL = "musl";
export {
  versionSync,
  version,
  isNonGlibcLinuxSync,
  isNonGlibcLinux,
  familySync,
  family,
  MUSL,
  GLIBC
};
