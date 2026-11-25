import { mock } from "bun:test";
mock.module("./helpers.mjs", () => ({
  lay() {
    console.log("mocked");
  },
}));
