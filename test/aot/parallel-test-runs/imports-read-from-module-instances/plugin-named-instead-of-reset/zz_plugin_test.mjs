import { test } from "bun:test";
test.skip("names the plugin", () => { console.log(typeof Bun.plugin); });
