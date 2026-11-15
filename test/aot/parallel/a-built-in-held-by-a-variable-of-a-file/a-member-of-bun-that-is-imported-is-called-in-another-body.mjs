// An import cannot be assigned to: the variable that holds the member is stored once, at the head of the file. So the call in start() is seen with its operands,
// as if Bun.serve(..) were written out, and the program brings what that form brings. Were the member let go at the store, any option might be passed to it where nobody looks.
// STATISTIC: ImageFunctionsEmitted <= 420
import { serve } from "bun";
function start() {
  return serve({
    port: 0,
    fetch() {
      return new Response("1");
    },
  });
}
const server = start();
console.log(typeof server.port);
server.stop(true);
