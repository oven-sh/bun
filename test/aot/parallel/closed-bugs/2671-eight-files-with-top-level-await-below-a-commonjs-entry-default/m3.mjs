import "./show.cjs";
export * from "./m5.mjs";
await 0;
await Promise.resolve("m3");
export const first = "m3.first";
export let second = 2;
export const count = 1;
say("m3 begins");
try {
  await Promise.reject(new Error("no"));
} catch (error) {
  say("m3 caught", error.message);
}
export default function () {
  return "m3";
}
say("m3 ends");
