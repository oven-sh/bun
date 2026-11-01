// Started by ../every-build.test.ts. No list names it.
import { beforeAll, describe, eachRow, gap, test, testOneByOne } from "../supported";
const ran = (name: string) => console.error("RAN " + name);
beforeAll(() => ran("beforeAll"));
test("test", () => ran("test"));
testOneByOne("testOneByOne", () => ran("testOneByOne"));
test.concurrent("concurrent", () => ran("concurrent"));
test.serial("serial", () => ran("serial"));
test.if(true)("if", () => ran("if"));
test.skipIf(false)("skipIf", () => ran("skipIf"));
test.todoIf(false)("todoIf", () => ran("todoIf"));
test.concurrent.each([1, 2])("concurrent each %d", n => ran("concurrent each " + n));
test.each([[1, 2]])("each %d %d", (a, b) => ran("each " + a + b));
test.skipIf(false).each([1])("skipIf each %d", n => ran("skipIf each " + n));
test.failing("failing", () => { ran("failing"); throw new Error("as it should"); });
test.skip("skip", () => ran("skip"));
test.todo("todo");
eachRow([[1], gap("not yet", [2])])("row %d", n => ran("row " + n));
describe("describe", () => {
  ran("the body of describe");
  beforeAll(() => ran("beforeAll in describe"));
  test("inside", () => ran("inside"));
});
describe.each([1])("describe each %d", n => { ran("the body of describe each"); test("inside", () => ran("inside each")); });
describe.skipIf(false)("describe skipIf", () => { test("inside", () => ran("inside skipIf")); });
describe.concurrent("describe concurrent", () => { test("inside", () => ran("inside concurrent")); });
