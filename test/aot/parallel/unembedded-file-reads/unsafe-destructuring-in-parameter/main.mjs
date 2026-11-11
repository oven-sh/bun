// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { byComputedKey, outOfTheRest, stores } from "./lib/read.mjs";
try {
  console.log("read", JSON.stringify(String(stores({ moduleUrl: import.meta.url, other: "file:///made-up/place/x.mjs" }))));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(String(byComputedKey({ moduleUrl: import.meta.url, other: "file:///made-up/place/x.mjs" }))));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(String(outOfTheRest({ moduleUrl: import.meta.url, other: "file:///made-up/place/x.mjs" }))));
} catch (error) {
  console.log("caught", error.code);
}
