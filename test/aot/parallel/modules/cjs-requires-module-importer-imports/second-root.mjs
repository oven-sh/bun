import first from "./first-file.cjs";
import second from "./second-file.cjs";
import "./third-part.mjs";
console.log("second root runs", first.late, second.late);
