"use strict";
var UNITS = { mm: 1, cm: 10, dm: 100 };
var measured = 0;
function measure(text) {
  var found = /^(\d+)(mm|cm|dm)$/.exec(text);
  measured++;
  return found === null ? -1 : +found[1] * UNITS[found[2]];
}
