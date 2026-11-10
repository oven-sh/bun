import { test, vi, jest, mock } from "bun:test";
import { seen as ofFile } from "./own.mjs";
import { seen as ofPackage } from "reads";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked", added: "added" }));
test("t", async () => {
  console.log("SAID while", await ofFile(), "|", await ofPackage(), "|", await ofFile());
  vi.doUnmock("dep");
  console.log("SAID behind doUnmock", await ofFile(), "|", await ofPackage());
  mock.restore();
  console.log("SAID behind restore", await ofFile(), "|", await ofPackage());
});
