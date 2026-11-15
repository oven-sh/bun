// The name that the Worker is given is made of itself, in a function that nobody calls. The build ends.
import { Worker } from "node:worker_threads";
function never() {
  var here: any = new URL(here);
  return new Worker(here);
}
console.log(typeof never);
