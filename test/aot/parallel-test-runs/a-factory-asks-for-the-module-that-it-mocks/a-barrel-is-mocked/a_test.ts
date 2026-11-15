// The mocked module hands on the names of another.
import { test, mock } from "bun:test";
mock.module("./barrel", async () => ({ ...(await import("./barrel")), more: "mock more" }));
test("a", async () => { const barrel = await import("./barrel"); console.log("a", barrel.rate, barrel.fee, barrel.more, (await import("./reader")).read()); });
