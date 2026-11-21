import computed from "./computed.cjs";
import kept from "./kept.cjs";
import written from "./written.cjs";
for (const value of [written, computed, kept]) {
  console.log(typeof value, typeof value === "object" ? Object.keys(value).join() : value);
}
