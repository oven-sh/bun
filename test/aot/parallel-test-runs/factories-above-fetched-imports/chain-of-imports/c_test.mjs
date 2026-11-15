import { test } from "vitest";
export const late = () => Bun.plugin({ name: "late", setup() {} });
test("last file", () => {});
