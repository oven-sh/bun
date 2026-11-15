export function look() {
  const { kMark } = require("./marks.cjs");
  const page = { undefined: "under undefined" };
  if (kMark) page[kMark] = "under the symbol";
  return typeof kMark + ":" + page[kMark];
}
