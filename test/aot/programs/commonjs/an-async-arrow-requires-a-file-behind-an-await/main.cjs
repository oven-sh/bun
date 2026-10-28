// An async arrow requires a file behind an await.
console.log("start");
(async () => {
  const x = require("./x.cjs");
  await null;
  const y = require("./y.cjs");
  console.log(x.v, y.v, y.seen);
})();
globalThis.flag = "set after the first turn";
console.log("end of body");
