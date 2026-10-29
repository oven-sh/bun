// A declaration file types what a JavaScript file makes: a literal or an Error
import { make, list } from "./outside.js";
interface HasMessage {
  message: string;
}
function tell(x: HasMessage): string {
  return x.message + "|" + Error.isError(x) + "|" + (x instanceof Error) + "|" + Object.keys(x).join();
}
for (let round = 0; round < 3; round++) {
  console.log(tell(make(round)));
  for (const x of list) console.log(tell(x));
}
