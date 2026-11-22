import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.mjs", async () => ({ ...(await import("./tax.mjs")), rate: 9 }));
test("partial", async () => {
  const { sold } = await import("./sale.mjs");
  console.log("sold", sold());
  const mocked = await import("./tax.mjs");
  console.log("mocked", mocked.rate, mocked.fee(), ++mocked.box.n);
  const actual = await vi.importActual("./tax.mjs");
  console.log("actual", actual.rate, actual.fee(), ++actual.box.n, actual.fee === mocked.fee, actual.box === mocked.box);
  console.log("sold again", sold());
});
