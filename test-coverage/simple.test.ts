import { test, expect } from "bun:test"; function add(a, b) { return a + b; } test("add", () => { expect(add(1, 2)).toBe(3); });
