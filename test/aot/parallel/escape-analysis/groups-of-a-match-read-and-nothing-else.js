// `const match = pattern.exec(text)`, and of the match no more than whether there is one and a group of it is asked, as mime-types does for every response.
// The list of the groups is made for nobody.
// COUNT: branches >= 1
// COUNT: cells <= 45000
"use strict";
const db = {
  "text/html": { charset: "UTF-8" },
  "application/json": { charset: "UTF-8" },
  "image/png": {},
  "text/x-odd": {},
};
const EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
const TEXT_TYPE_REGEXP = /^text\//i;
function charset(type) {
  if (!type || typeof type !== "string") return false;
  var match = EXTRACT_TYPE_REGEXP.exec(type);
  var mime = match && db[match[1].toLowerCase()];
  if (mime && mime.charset) return mime.charset;
  if (match && TEXT_TYPE_REGEXP.test(match[1])) return "UTF-8";
  return false;
}
function first(type) {
  var match = EXTRACT_TYPE_REGEXP.exec(type);
  return match && match[1];
}
const types = [
  "text/html; charset=x",
  "application/json",
  "image/png",
  "text/x-odd",
  "TEXT/unknown",
  "other/thing ; q",
  "",
];
let sum = 0;
for (let i = 0; i < 70000; i++) sum += String(charset(types[i % 7])).length + String(first(types[i % 7])).length;
console.log(sum, types.map(charset).join(), types.map(first).join());
