var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/thirdparty/detect-libc.linux.js


// Hardcoded module "detect-libc" for linux
function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return GLIBC;
}

const GLIBC = "glibc";
const MUSL = "musl";

function version() {
  return Promise.resolve(versionSync());
}

function versionSync() {
  return "2.29";
}

function isNonGlibcLinuxSync() {
  return false;
}

function isNonGlibcLinux() {
  return Promise.resolve(isNonGlibcLinuxSync());
}

$ = {
  GLIBC,
  MUSL,
  family,
  familySync,
  isNonGlibcLinux,
  isNonGlibcLinuxSync,
  version,
  versionSync,
};
$$EXPORT$$($).$$EXPORT_END$$;
