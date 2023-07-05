function version() {
  return libcVersion;
}
function versionAsync() {
  return Promise.resolve(libcVersion);
}
function family() {
  return libcFamily;
}
function familyAsync() {
  return Promise.resolve(libcFamily);
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
  versionAsync,
  version,
  isNonGlibcLinuxSync,
  isNonGlibcLinux,
  familyAsync,
  family,
  MUSL,
  GLIBC
};
