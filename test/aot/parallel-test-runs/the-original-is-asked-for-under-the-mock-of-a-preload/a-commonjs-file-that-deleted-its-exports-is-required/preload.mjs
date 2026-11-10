import { mock } from "bun:test";
mock.module("./lib.cjs", async original => ({ ...(await original()), a: "mocked" }));
