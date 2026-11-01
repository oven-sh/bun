// Started by ../every-build.test.ts. No list names it.
import { afterAll, afterEach, beforeAll, beforeEach, it, test } from "../listed";
import { describe } from "../listed";
const ran = (name: string) => console.error("RAN " + name);
beforeAll(() => ran("beforeAll"));
afterAll(() => ran("afterAll"));
beforeEach(() => ran("beforeEach"));
afterEach(() => ran("afterEach"));
test("test", () => ran("test"));
it("it", () => ran("it"));
test.concurrent("concurrent", () => ran("concurrent"));
test.skipIf(false)("skipIf", () => ran("skipIf"));
test.each([1, 2])("each %d", n => ran("each " + n));
describe("describe", () => {
  ran("the body of describe");
  afterAll(() => ran("afterAll in describe"));
  it.each([1])("inside %d", () => ran("inside"));
});
describe.skipIf(false).each([1])("describe each %d", () => { test("inside", () => ran("inside each")); });
