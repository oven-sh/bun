import defer * as deferred from "./a.mjs";
import * as eager from "./a.mjs";
console.log(
  "main begins",
  deferred === eager,
  Object.prototype.toString.call(deferred),
  Object.prototype.toString.call(eager),
  deferred.value === eager.value,
);
