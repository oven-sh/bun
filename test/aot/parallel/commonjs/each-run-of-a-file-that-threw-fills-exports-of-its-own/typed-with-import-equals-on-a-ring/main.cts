try {
  require("./wheel.cts");
} catch (e) {
  console.log("caught", (e as Error).message);
}
import wheel = require("./wheel.cts");
import spoke = require("./spoke.cts"); // @ts-expect-error
console.log(wheel.turn, spoke.seen());
