import { bench, run } from "../runner.mjs";

let decodeURIComponentSIMD;
if (typeof Bun !== "undefined") {
  ({ decodeURIComponentSIMD } = await import("bun:internal-for-testing"));
}

const hugeText = Buffer.alloc(1000000, "Hello, world!").toString();
const hugeTextWithPercentAtEnd = Buffer.alloc(1000000, "Hello, world!%40").toString();

const tinyText = Buffer.alloc(100, "Hello, world!").toString();
const tinyTextWithPercentAtEnd = Buffer.alloc(100, "Hello, world!%40").toString();

const veryTinyText = Buffer.alloc(8, "a").toString();
const veryTinyTextWithPercentAtEnd = Buffer.alloc(8, "a%40").toString();

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD -  no % x 8 bytes", () => {
    decodeURIComponentSIMD(veryTinyText);
  });

bench("    decodeURIComponent -  no % x 8 bytes", () => {
  decodeURIComponent(veryTinyText);
});

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD - yes % x 8 bytes", () => {
    decodeURIComponentSIMD(veryTinyTextWithPercentAtEnd);
  });

bench("    decodeURIComponent - yes % x 8 bytes", () => {
  decodeURIComponent(veryTinyTextWithPercentAtEnd);
});

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD -  no % x 100 bytes", () => {
    decodeURIComponentSIMD(tinyText);
  });

bench("    decodeURIComponent -  no % x 100 bytes", () => {
  decodeURIComponent(tinyText);
});

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD - yes % x 100 bytes", () => {
    decodeURIComponentSIMD(tinyTextWithPercentAtEnd);
  });

bench("    decodeURIComponent - yes % x 100 bytes", () => {
  decodeURIComponent(tinyTextWithPercentAtEnd);
});

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD -  no % x 1 MB", () => {
    decodeURIComponentSIMD(hugeText);
  });

bench("    decodeURIComponent -  no % x 1 MB", () => {
  decodeURIComponent(hugeText);
});

decodeURIComponentSIMD &&
  bench("decodeURIComponentSIMD - yes % x 1 MB", () => {
    decodeURIComponentSIMD(hugeTextWithPercentAtEnd);
  });

bench("    decodeURIComponent - yes % x 1 MB", () => {
  decodeURIComponent(hugeTextWithPercentAtEnd);
});

await run();
