import { test, vi, mock, jest } from "bun:test";
import { count, bump, get } from "made-up-pkg";
test("b", () => { bump(); console.log("SAID b", count, get()); });
