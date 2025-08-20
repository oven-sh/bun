beforeAll(() => console.log("beforeall1"));
beforeAll(() => console.log("beforeall2"));
beforeEach(() => console.log("beforeeach1"));
beforeEach(() => console.log("beforeeach2"));

afterAll(() => console.log("afterall1"));
afterAll(() => console.log("afterall2"));
afterEach(() => console.log("aftereach1"));
afterEach(() => console.log("aftereach2"));

test.skip("test skip", () => console.log("test skip"));
test("test1", () => console.log("test1"));

if ("forDebuggingExecuteTestsNow" in describe) {
  await describe.forDebuggingExecuteTestsNow();
  describe.forDebuggingDeinitNow();
}
