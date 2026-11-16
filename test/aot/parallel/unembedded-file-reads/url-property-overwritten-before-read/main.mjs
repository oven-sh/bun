// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { assigns, deletes, handsOn, reads, stores } from "./lib/read.mjs";
const far = { url: "file:///made-up/place/x.mjs" };
try {
  console.log("read", JSON.stringify(stores({ url: import.meta.url })));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(deletes({ url: import.meta.url })));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(assigns({ url: import.meta.url })));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(handsOn({ url: import.meta.url })));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(reads({ url: import.meta.url, url: "file:///made-up/place/x.mjs" })));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(reads({ url: import.meta.url, ...far })));
} catch (error) {
  console.log("caught", error.code);
}
