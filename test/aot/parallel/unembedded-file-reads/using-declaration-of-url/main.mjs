// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readBeside } from "./lib/read.mjs";
function hand() {
  using here = import.meta.url;
  return readBeside(here);
}
try {
  console.log("read", JSON.stringify(String(hand())));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
