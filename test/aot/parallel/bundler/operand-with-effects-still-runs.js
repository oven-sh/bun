let n = 0;
const bump = () => ++n;
if ((bump(), false)) require("./missing");
(bump(), true) || require("./missing-2");
console.log(n);
