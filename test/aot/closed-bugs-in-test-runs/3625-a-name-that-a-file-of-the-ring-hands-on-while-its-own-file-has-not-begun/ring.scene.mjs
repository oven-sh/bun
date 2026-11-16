import { test } from "bun:test";
test("an-unused-constant-is-given-the-constant", async () => {
  let said = "";
  try {
    said = (await import("./an-unused-constant-is-given-the-constant/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID an-unused-constant-is-given-the-constant " + said);
});
test("the-constant-stands-alone-as-a-statement", async () => {
  let said = "";
  try {
    said = (await import("./the-constant-stands-alone-as-a-statement/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID the-constant-stands-alone-as-a-statement " + said);
});
test("an-unused-constant-is-given-the-let", async () => {
  let said = "";
  try {
    said = (await import("./an-unused-constant-is-given-the-let/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID an-unused-constant-is-given-the-let " + said);
});
test("an-unused-class-stands-below-the-class", async () => {
  let said = "";
  try {
    said = (await import("./an-unused-class-stands-below-the-class/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID an-unused-class-stands-below-the-class " + said);
});
test("an-unused-class-expression-stands-below-the-class", async () => {
  let said = "";
  try {
    said = (await import("./an-unused-class-expression-stands-below-the-class/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID an-unused-class-expression-stands-below-the-class " + said);
});
test("the-value-is-used", async () => {
  let said = "";
  try {
    said = (await import("./the-value-is-used/head.mjs")).told;
  } catch (error) {
    said = error instanceof ReferenceError ? "dead" : error instanceof Error ? error.name : "other";
  }
  console.log("SAID the-value-is-used " + said);
});
