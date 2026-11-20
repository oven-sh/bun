import { expect, test, vi } from "bun:test";
import { floorOfRoom } from "./lamp";
vi.mock("./door", () => ({ width: () => 3 }));
vi.mock("./room", async (importOriginal) => ({ ...(await importOriginal<any>()), floor: 5 }));
test("another floor", () => {
  console.log("SEEN", require("./room").floor, floorOfRoom());
  expect(floorOfRoom()).toBe(5);
});
