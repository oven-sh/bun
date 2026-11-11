// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { byMember, byPattern } from "./lib/read.mjs";
try {
  console.log("read", JSON.stringify(String(byPattern({
  moduleUrl: import.meta.url,
  other: new URL("./elsewhere/x.mjs", import.meta.url).href,
  get early() {
    this.moduleUrl = this.other;
    return 1;
  },
}))));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(String(byMember({
  moduleUrl: import.meta.url,
  other: new URL("./elsewhere/x.mjs", import.meta.url).href,
  get early() {
    this.moduleUrl = this.other;
    return 1;
  },
}))));
} catch (error) {
  console.log("caught", error.code);
}
