import { test, mock } from "bun:test";
mock.module("./mocked.mjs", () => ({ other: 5, n: 9 }));
const said = async load => {
    try {
        const whole = await load();
        return Object.keys(whole).sort().map(key => key + "=" + String(whole[key])).join();
    } catch (error) {
        return error.name;
    }
};
test("t", async () => {
    console.log("SAID r", await said(() => import("./z-r.mjs")));
    console.log("SAID s", await said(() => import("./a-s.mjs")));
    console.log("SAID x", await said(() => import("./x.mjs")));
});
