(function (){"use strict";// build2/tmp/thirdparty/detect-libc.ts
var family = function() {
  return @Promise.resolve(familySync());
};
var familySync = function() {
  return null;
};
var version = function() {
  return @Promise.resolve(versionSync());
};
var versionSync = function() {
  return null;
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
