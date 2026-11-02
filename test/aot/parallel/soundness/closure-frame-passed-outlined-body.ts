// A closure in a frame is passed to an outlined body in a validating build.
// Flags: --aot-validate
declare const console: { log(...values: unknown[]): void };
declare function queueMicrotask(f: () => void): void;
declare function setTimeout(f: () => void, ms: number): unknown;
declare function setImmediate(f: () => void): unknown;
declare const process: { nextTick(f: () => void): void };
const k: string = ["x"].join("");
let sink: unknown, moduleVariable: number = 1;
const show = (v: unknown) => JSON.stringify(v, (key, each) => each === undefined ? "undefined" : typeof each === "bigint" ? String(each) : each);
async function t(name: string, f: () => unknown) { let r; try { r = show(await f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r); }
await t("class-fields store-object class-member-name function", async () => {
let change: () => void = () => {};
class C {
x = 1;
y = 2;
m() {
}
} const o = new C();
change = () => {
const a = o as any;
a.x = {
valueOf() {
}
};
};
const get = () => o;
function read() {
const part: string[] = [];
part.push(String(get().x), String(get().y));
try {
part.push(String(get().m()));
} catch (e) {
} try {
} catch (e) {
} sink = class {
[(change(), "k")]() {}
};
part.push(String(get().x), String(get().y));
try {
part.push(String(get().m()));
} catch (e) {
part.push((e as Error).name);
} return part;
} const r = read();
return [r, Object.keys(o).join(), Object.isFrozen(o)];
});
await t("class-fields store-object bound rest", async () => {
let change: () => void = () => {};
class C {
m() {
}
} const o = new C();
change = () => {
const a = o as any;
a.x = {
valueOf() {
}
};
};
function read(...all: C[]) {
const part: string[] = [];
try {
} catch (e) {
} return part;
} const r = read(o);
});
