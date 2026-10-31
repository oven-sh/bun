/** @jsxImportSource ./mini */
"use strict";
console.log("other starts", this === module.exports);
module.exports = a => (
  <s>
    {a}
    {"!"}
  </s>
);
