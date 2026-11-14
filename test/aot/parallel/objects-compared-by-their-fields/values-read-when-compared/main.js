// util.isDeepStrictEqual and assert.deepStrictEqual read each value of an object when they compare it, however the two objects were made: a getter below an earlier key that stores into, deletes, adds, hides or redefines a later key of either object is seen at the later key, string keys are compared before symbol keys, and a getter that an object gains under a key that only the other object had is called.
import { gains, orders, rows } from "./cases.js";

for (const row of rows()) console.log(row);
for (const order of orders()) console.log(order);
for (const gain of gains()) console.log(gain);
