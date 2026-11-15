import { test, vi } from "bun:test";
import { seen } from "typed";
// It lacks `helper` and adds `extra`.
vi.mock("./dep.js", () => ({ value: () => "mocked", extra: 1 }));
test("import() in a package is answered with the module itself", async () => {
  const ofPackage = await seen();
  console.log("package", ofPackage.value(), Object.keys(ofPackage).sort().join());
  const ofTestFile = await import("./dep.js");
  console.log("test file", ofTestFile.value(), Object.keys(ofTestFile).sort().join());
  console.log("the package gets one object", (await seen()) === ofPackage);
  console.log("the test file gets it too", ofTestFile === ofPackage);
});
