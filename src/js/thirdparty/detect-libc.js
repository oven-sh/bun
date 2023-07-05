// https://www.npmjs.com/package/detect-libc

const {
  version: libcVersion,
  family: libcFamily,
} = globalThis[Symbol.for("Bun.lazy")]("detect-libc");

export const GLIBC = "glibc";
export const MUSL = "musl";

export function version() {
  return libcVersion;
}

export function versionAsync() {
  return Promise.resolve(libcVersion);
}

export function family() {
  return libcFamily;
}

export function familyAsync() {
  return Promise.resolve(libcFamily);
}

export function isNonGlibcLinux() {
  return Promise.resolve(libcFamily === MUSL);
}

export function isNonGlibcLinuxSync() {
  return libcFamily === MUSL;
}
