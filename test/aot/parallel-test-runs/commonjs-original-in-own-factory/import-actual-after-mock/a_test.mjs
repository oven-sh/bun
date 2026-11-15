import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.cjs", async () => ({ ...(await import("./tax.cjs")), rate: 9 }));
test("partial", async () => {
  const { sold } = await import("./sale.mjs");
  console.log("SAID sold", sold());
  const mocked = await import("./tax.cjs");
  console.log("SAID mocked", mocked.rate, mocked.fee(), ++mocked.box.n);
  const actual = await vi.importActual("./tax.cjs");
  console.log("SAID actual", actual.rate, actual.fee(), ++actual.box.n, actual.fee === mocked.fee, actual.box === mocked.box);
  console.log("SAID sold again", sold());
});
