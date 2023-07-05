// https://www.npmjs.com/package/detect-libc

const { version: libcVersion, family: libcFamily } = globalThis[Symbol.for("Bun.lazy")]("detect-libc");

export const GLIBC = "glibc";
export const MUSL = "musl";

export function version() {
  return Promise.resolve(libcVersion);
}

export function versionSync() {
  return libcVersion;
}

export function family() {
  return Promise.resolve(libcFamily);
}

export function familySync() {
  return libcFamily;
}

export function isNonGlibcLinux() {
  return Promise.resolve(libcFamily === MUSL);
}

export function isNonGlibcLinuxSync() {
  return libcFamily === MUSL;
}
