var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/thirdparty/detect-libc.js


// Hardcoded module "detect-libc" for darwin
function family() {
  return Promise.resolve(familySync());
}

function familySync() {
  return null;
}

const GLIBC = "glibc";
const MUSL = "musl";

function version() {
  return Promise.resolve(versionSync());
}

function versionSync() {
  return null;
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
