import { beforeEach, describe, expect, it, test } from "bun:test";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe("timeouts", () => {
  it("by the third argument", async () => {
    await sleep(200);
  }, 20);
  it(
    "by an option",
    async () => {
      await sleep(200);
    },
    { timeout: 20 },
  );
  it("done is never called", done => {
    expect(typeof done).toBe("function");
  }, 20);
  it("a promise that never settles", () => new Promise<void>(() => {}), 20);
  describe("in a hook", () => {
    beforeEach(async () => {
      await sleep(200);
    }, 20);
    it("waits for the hook", () => {});
  });
});

test("passes", () => {});
