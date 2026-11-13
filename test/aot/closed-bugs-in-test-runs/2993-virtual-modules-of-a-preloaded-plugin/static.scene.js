import { expect, test } from "bun:test";
import fromStatic from "virtual:static";
test("05 registered in the preload, an import statement", () => { console.error("SEEN 05 registered in the preload, an import statement | " + fromStatic); expect(fromStatic).toBe("static"); });
