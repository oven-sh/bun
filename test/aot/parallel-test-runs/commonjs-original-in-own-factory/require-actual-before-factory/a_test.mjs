import { jest, mock, test, vi } from "bun:test";
test("partial", async () => {
  vi.doMock("./tax.cjs", async () => ({ ...(await import("./tax.cjs")), rate: 9 }));
  const actual = jest.requireActual("./tax.cjs");
  const { sold } = await import("./sale.mjs");
  console.log("SAID sold", sold());
  const mocked = await import("./tax.cjs");
  console.log("SAID mocked", mocked.rate, mocked.fee(), ++mocked.box.n);
  console.log("SAID actual", actual.rate, actual.fee(), ++actual.box.n, actual.fee === mocked.fee, actual.box === mocked.box);
  console.log("SAID sold again", sold());
});
