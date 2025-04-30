test("Checking with 1, Expected: true", () => {
  let decoder1 = new TextDecoder("utf-8", { fatal: 1 });
  expect(decoder1.fatal).toBe(true);
 });

test("Checking with 0, Expected: false", () => {
  let decoder1 = new TextDecoder("utf-8", { fatal: 0 });
  expect(decoder1.fatal).toBe(false);
 });
 
test("Checking with a string, Expected: true", () => {
  let decoder1 = new TextDecoder("utf-8", { fatal: "string" });
  expect(decoder1.fatal).toBe(true);
 });

test("Checking with null, Expected: false", () => {
  console.log("Checking with null");
  let decoder1 = new TextDecoder("utf-8", { fatal: null });
  expect(decoder1.fatal).toBe(false);
 });

test("Checking with empty string, Expected: false", () => {
  console.log("Checking with empty string");
  let decoder1 = new TextDecoder("utf-8", { fatal: "" });
  expect(decoder1.fatal).toBe(false);
 });

