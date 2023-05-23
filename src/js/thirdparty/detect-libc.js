// Hardcoded module "detect-libc"
export function family() {
  return Promise.resolve(familySync());
}

export function familySync() {
  if (process.platform === 'linux') {
    return GLIBC;
  } else {
    return null;
  }
}

export const GLIBC = "glibc";
export const MUSL = "musl";

export function versionAsync() {
  return Promise.resolve(version());
}

export function version() {
  if (process.platform === 'linux') {
    return "2.29";
  } else {
    return null;
  }
}

export function isNonGlibcLinuxSync() {
  return false;
}

export function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}
