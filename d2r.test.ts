beforeAll(() => console.log("beforeall1"));
beforeAll(() => console.log("beforeall2"));
beforeEach(() => {
  throw new Error("beforeEach");
});
beforeEach(() => console.log("beforeeach2"));

afterAll(() => console.log("afterall1"));
afterAll(() => console.log("afterall2"));
afterEach(() => console.log("aftereach1"));
afterEach(() => {
  throw "aftereach2";
});

test("test", () => console.log("test"));
test("test1", () => console.log("test1"));
