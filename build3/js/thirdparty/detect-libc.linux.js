(function (){"use strict";// build3/tmp/thirdparty/detect-libc.linux.ts
var family = function() {
  return @Promise.resolve(familySync());
};
var familySync = function() {
  return GLIBC;
};
var version = function() {
  return @Promise.resolve(versionSync());
};
var versionSync = function() {
  return "2.29";
};
var isNonGlibcLinuxSync = function() {
  return false;
};
var isNonGlibcLinux = function() {
  return @Promise.resolve(isNonGlibcLinuxSync());
};
var $;
var GLIBC = "glibc";
var MUSL = "musl";
$ = {
  GLIBC,
  MUSL,
  family,
  familySync,
  isNonGlibcLinux,
  isNonGlibcLinuxSync,
  version,
  versionSync
};
return $})
