// bun only supports glibc at the time of writing
export function family() {
  return Promise.resolve(GLIBC);
}

export function familySync() {
  return GLIBC;
}

export const GLIBC = "glibc";
export const MUSL = "musl";

export function versionAsync() {
  return Promise.resolve(version());
}

export function version() {
  return "2.29";
}

export function isNonGlibcLinuxSync() {
  return false;
}

export function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}
