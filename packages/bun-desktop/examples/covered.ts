// For selftest.ts: of an addon and the app, the one that is last to ask for a color of the window gets it, launch cover or not.
import { app, Window } from "bun:desktop";
import { dlopen } from "bun:ffi";

const step = process.env.STEP;
const objc = (name: string, args: string[], returns = "ptr") =>
  (dlopen("/usr/lib/libobjc.A.dylib", { [name]: { args, returns } } as any).symbols as any)[name];
const named = (lookUp: string, name: string) => objc(lookUp, ["ptr"])(Buffer.from(name + "\0"));
const get = (receiver: unknown, selector: string) =>
  objc("objc_msgSend", ["ptr", "ptr"])(receiver, named("sel_registerName", selector));

await app.whenReady();
const window = new Window({ x: 100, y: 100, width: 300, height: 200, vibrancy: "sidebar", launchCover: true });
window.setVibrancy(null);
const wasCovered = window.isLaunchCoverShown();
const native = get(Number(window.getNativeWindowHandle().readBigUInt64LE()), "window");
const red = get(named("objc_getClass", "NSColor"), "redColor");
if (step === "earlier") window.setBackgroundColor("#00000000");
window.getBounds();
await Bun.sleep(100);
const [perform, set] = ["performSelectorOnMainThread:withObject:waitUntilDone:", "setBackgroundColor:"].map(it =>
  named("sel_registerName", it),
);
objc("objc_msgSend", ["ptr", "ptr", "ptr", "ptr", "bool"], "void")(native, perform, set, red, true);
if (step === "later") window.setBackgroundColor("#00000000");
window.endLaunchCover();
await Bun.sleep(300);
if (step === "after") window.setBackgroundColor("#00000000");
await Bun.sleep(300);
const isRed = objc("objc_msgSend", ["ptr", "ptr", "ptr"], "bool")(
  get(native, "backgroundColor"),
  named("sel_registerName", "isEqual:"),
  red,
);
if (step === "save") console.log((await window.saveLaunchCover()) ? "PASS" : "FAIL", "the cover is saved");
else
  console.log(
    wasCovered && isRed === (step === "earlier") ? "PASS" : "FAIL",
    `the app asks ${step}: covered ${wasCovered}, the addon's color ${isRed}`,
  );
app.quit();
