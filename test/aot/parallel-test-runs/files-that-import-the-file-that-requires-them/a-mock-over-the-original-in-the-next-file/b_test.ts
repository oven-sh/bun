import { expect, test, vi } from "bun:test";
import { floor, floorByLamp, size } from "./room";
vi.mock("./room", async (importOriginal) => ({ ...(await importOriginal<typeof import("./room")>()), floor: 5 }));
test("another floor", () => {
  console.log("SEEN", floor, size(1), floorByLamp());
  expect(floor).toBe(5);
});
