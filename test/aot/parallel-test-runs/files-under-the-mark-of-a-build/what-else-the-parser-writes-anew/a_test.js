import { test } from "bun:test";
test("what the parser writes anew", async () => {
  try {
    console.log("glob under-the-mark: " + (await import("./glob-under-the-mark.js")).found);
  } catch (error) {
    console.log("glob under-the-mark: " + error.name + ": " + error.message);
  }
  try {
    console.log("chai under-the-mark: " + (await import("./chai-under-the-mark.js")).found);
  } catch (error) {
    console.log("chai under-the-mark: " + error.name + ": " + error.message);
  }
  try {
    console.log("path under-the-mark: " + (await import("./path-under-the-mark.js")).found);
  } catch (error) {
    console.log("path under-the-mark: " + error.name + ": " + error.message);
  }
  try {
    console.log("glob without-the-mark: " + (await import("./glob-without-the-mark.js")).found);
  } catch (error) {
    console.log("glob without-the-mark: " + error.name + ": " + error.message);
  }
  try {
    console.log("chai without-the-mark: " + (await import("./chai-without-the-mark.js")).found);
  } catch (error) {
    console.log("chai without-the-mark: " + error.name + ": " + error.message);
  }
  try {
    console.log("path without-the-mark: " + (await import("./path-without-the-mark.js")).found);
  } catch (error) {
    console.log("path without-the-mark: " + error.name + ": " + error.message);
  }
});
