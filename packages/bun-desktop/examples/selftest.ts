// bun selftest.ts [directory]       runs every renderer with one thread and with two, and saves logs and pictures
// bun selftest.ts [directory] try   leaves a window open to try things by hand
import { dlopen, ptr } from "bun:ffi";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const isMac = process.platform === "darwin";
const [directory = "selftest-results", mode = "all"] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });

async function run(name: string, mode: string, env: Record<string, string>) {
  const log = join(directory, name + ".log");
  const output = mode === "try" ? "inherit" : Bun.file(log);
  const child = Bun.spawn([process.execPath, import.meta.path, directory, "run-" + mode], {
    env: { ...process.env, BUN_DESKTOP_LOG: "1", SELFTEST_NAME: name, ...env },
    stdio: ["ignore", output, mode === "try" ? "inherit" : Bun.file(join(directory, name + ".library.log"))],
  });
  const hung = setTimeout(
    () => {
      if (isMac) Bun.spawnSync(["sample", String(child.pid), "2", "-file", join(directory, name + ".stacks.txt")]);
      child.kill("SIGKILL");
    },
    mode === "try" ? 600_000 : 120_000,
  );
  const code = await child.exited;
  clearTimeout(hung);
  if (mode === "try") return;
  const lines = (await Bun.file(log).text()).split("\n").filter(line => /PASS|FAIL|INFO/.test(line));
  const library = await Bun.file(join(directory, name + ".library.log")).text();
  lines.push(
    ...library
      .split("\n")
      .filter(line => /GPU is|is ready|launched|layers:|panic|error|failed/i.test(line))
      .slice(0, 10),
  );
  console.log(
    `\n${name}: ${code === 0 ? "finished" : `FAIL ended with ${child.signalCode ?? code}`}\n${lines.join("\n")}`,
  );
}

if (mode === "try") await run("try", mode, { BUN_DESKTOP_THREADS: process.env.BUN_DESKTOP_THREADS ?? "2" });
if (mode === "all") {
  for (const renderer of isMac ? ["layers", "software"] : ["software"]) {
    for (const threads of ["2", "1"]) {
      await run(`${renderer}-${threads}`, mode, { BUN_DESKTOP_RENDERER: renderer, BUN_DESKTOP_THREADS: threads });
    }
    await run(`${renderer}-memory`, mode, {
      BUN_DESKTOP_RENDERER: renderer,
      BUN_DESKTOP_THREADS: "2",
      SELFTEST_PICTURES: "0",
    });
  }
}
if (mode === "all" && isMac) {
  Bun.spawnSync([
    process.execPath,
    "build",
    "--compile",
    "--desktop",
    join(import.meta.dir, "covered.ts"),
    "--outfile=" + join(directory, "covered"),
  ]);
  console.log("\ncovered:");
  for (const STEP of ["save", "earlier", "later", "after"]) {
    const app = join(directory, "covered.app/Contents/MacOS/covered");
    console.log(
      Bun.spawnSync([app], { env: { ...process.env, STEP }, timeout: 20_000 })
        .stdout.toString()
        .trim() || `FAIL ${STEP}`,
    );
  }
}
if (!mode.startsWith("run-")) process.exit(0);

process.on("uncaughtException", error => console.log("FAIL", error) ?? process.exit(1));
const before = process.memoryUsage.rss() >> 20;
const { app, clipboard, dialog, Menu, Tray, Window } = await import("bun:desktop");
const file = (what: string) => join(directory, `${process.env.SELFTEST_NAME}.${what}`);
const started = performance.now();
const log = (...values: unknown[]) => console.log((performance.now() - started).toFixed(0).padStart(6), ...values);
const check = (name: string, isGood: unknown, ...more: unknown[]) => log(isGood ? "PASS" : "FAIL", name, ...more);
async function until(condition: () => unknown, patience = 1500) {
  for (const end = performance.now() + patience; !condition() && performance.now() < end;) await Bun.sleep(5);
  return !!condition();
}
const window = new Window({ title: "Self-test", width: 900, height: 700, x: 80, y: 80, titleBarStyle: "hiddenInset" });
for (const name of ["focus", "blur", "resize", "move", "show", "hide", "close", "enter-full-screen"]) {
  window.on(name, () => log("window", name, JSON.stringify(window.getBounds())));
}
log("INFO created after", Math.round(process.uptime() * 1000), "ms, scale", window.devicePixelRatio);

const { document } = window;
const families = ["system-ui", "-apple-system", "ui-monospace, Menlo", "SF Mono, monospace", "serif", "Helvetica Neue"];
document.body.innerHTML = `
<style>
  body { margin: 0; font: 14px/20px system-ui; color: CanvasText; background: Canvas; color-scheme: light dark }
  header { height: 44px; -webkit-app-region: drag; background: #d97757; color: white; padding-left: 90px; line-height: 44px }
  main { display: grid; grid-template-columns: 1fr 300px; height: calc(100vh - 44px) }
  .boxes > * { display: inline-block; width: 70px; height: 50px; margin: 10px; vertical-align: top }
  #list { overflow: auto; border-left: 1px solid #8884 } #list p { margin: 8px 12px }
  @keyframes spin { to { transform: rotate(1turn) } }
</style>
<header>Drag me, and double-click me</header>
<main><section style="padding: 12px">
  ${families.map(it => `<div style="font-family: ${it}">${it}: Sphinx of <b>black quartz</b>, <i>judge</i> my vow 0123</div>`).join("")}
  ${[11, 13, 20, 28].map(it => `<div style="font-size: ${it}px; line-height: 1.3">Optical size ${it} <span style="font-weight: 300">light</span> <span style="font-weight: 600">semibold</span></div>`).join("")}
  <div>日本語のテキスト 中文文本 한국어 العربية עברית हिन्दी ไทย ⌘⇧⌥⌃⏎→✓ 😀👍🏽👨‍👩‍👧🇯🇵❤️</div>
  <div class="boxes">
    <i style="background: #f008"></i><i style="background: linear-gradient(90deg, red, blue); border-radius: 12px"></i>
    <i style="box-shadow: 0 4px 16px #0006; border-radius: 8px"></i><i style="border: 2px dashed green; border-radius: 50%"></i>
    <i style="background: teal; opacity: .5; transform: rotate(10deg)"></i><i style="background: orange; filter: blur(4px)"></i>
    <i style="background: purple; mask-image: linear-gradient(transparent, black)"></i>
    <i style="background: gray; width: 50px; animation: spin 2s linear infinite paused" id="spinner"></i>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>
    <canvas width="70" height="50"></canvas>
    <i style="background: repeating-linear-gradient(45deg, red 0 5px, yellow 5px 10px)"><b style="display: block; margin: 10px; height: 30px; backdrop-filter: blur(4px); border-radius: 8px"></b></i>
  </div>
  <textarea rows="2" cols="40" placeholder="Type here: dead keys, IME, press and hold, paste"></textarea> <a href="#">link</a>
</section><div id="list">${Array.from({ length: 400 }, (_, i) => `<p>Row ${i}: the quick brown fox jumps over the lazy dog, again and again.</p>`).join("")}</div></main>`;
const context = document.querySelector("canvas")!.getContext("2d")!;
context.fillStyle = "navy";
context.fillRect(5, 5, 60, 40);
for (const name of [
  "keydown",
  "keyup",
  "beforeinput",
  "compositionupdate",
  "compositionend",
  "click",
  "paste",
  "drop",
]) {
  document.addEventListener(name, (event: any) =>
    log(name, event.key ?? event.data ?? "", event.code ?? "", event.metaKey ? "meta" : ""),
  );
}
document.querySelector("textarea")!.focus();

const frame = () => new Promise<number>(resolve => window.window.requestAnimationFrame(resolve));
async function measure(name: string, count: number, step: (index: number) => void) {
  const [gaps, cpu]: [number[], NodeJS.CpuUsage] = [[], process.cpuUsage()];
  const counted = usage();
  for (let index = 0, last = await frame(); index < count; index++) {
    step(index);
    const now = await frame();
    gaps.push(now - last);
    last = now;
  }
  const { user, system } = process.cpuUsage(cpu);
  gaps.sort((a, b) => a - b);
  const at = (fraction: number) => gaps[Math.floor((count - 1) * fraction)].toFixed(1);
  log(
    "INFO",
    name,
    `gap p50 ${at(0.5)} p95 ${at(0.95)} max ${at(1)} ms, CPU ${((user + system) / count / 1000).toFixed(2)} ms/frame`,
  );
  if (isMac) log("INFO", name, (Number(usage()[5] - counted[5]) / count).toFixed(2), "wake-ups per frame");
}

/** While JavaScript does nothing. */
async function watch(name: string) {
  await Bun.sleep(500);
  const [cpu, counted] = [process.cpuUsage(), usage()];
  await Bun.sleep(3000);
  const { user, system } = process.cpuUsage(cpu);
  log(
    "INFO",
    name,
    `CPU ${((user + system) / 3000).toFixed(2)} ms/s, ${(Number(usage()[5] - counted[5]) / 3).toFixed(1)} wake-ups/s`,
  );
}

const cString = (text: string) => Buffer.from(text + "\0");
function bind(library: string, name: string, args: string[], returns: string): (...values: any[]) => any {
  return (dlopen(library, { [name]: { args, returns } } as any).symbols as any)[name];
}
const framework = (name: string) => `/System/Library/Frameworks/${name}.framework/${name}`;
/** Returns the one that was selected, if `id` is enabled. It only works on a main thread. */
function selectInputSource(id: string) {
  function select(wanted: string) {
    const { dlopen, read, CString } = require("bun:ffi");
    const path = (name: string) => `/System/Library/Frameworks/${name}.framework/${name}`;
    const call = (library: string, name: string, args: string[], returns: string, ...values: unknown[]) =>
      dlopen(library, { [name]: { args, returns } }).symbols[name](...values);
    const carbon = call("libSystem.B.dylib", "dlopen", ["ptr", "i32"], "ptr", Buffer.from(path("Carbon") + "\0"), 1);
    const key = read.ptr(
      call("libSystem.B.dylib", "dlsym", ["ptr", "ptr"], "ptr", carbon, Buffer.from("kTISPropertyInputSourceID\0")),
    );
    const idOf = (source: unknown) => {
      const [text, id] = [
        Buffer.alloc(256),
        call(path("Carbon"), "TISGetInputSourceProperty", ["ptr", "ptr"], "ptr", source, key),
      ];
      call(
        path("CoreFoundation"),
        "CFStringGetCString",
        ["ptr", "ptr", "i64", "u32"],
        "bool",
        id,
        text,
        256,
        0x08000100,
      );
      return String(new CString(require("bun:ffi").ptr(text)));
    };
    const before = idOf(call(path("Carbon"), "TISCopyCurrentKeyboardInputSource", [], "ptr"));
    const all = call(path("Carbon"), "TISCreateInputSourceList", ["ptr", "bool"], "ptr", null, false);
    for (let at = Number(call(path("CoreFoundation"), "CFArrayGetCount", ["ptr"], "i64", all)); at--;) {
      const source = call(path("CoreFoundation"), "CFArrayGetValueAtIndex", ["ptr", "i64"], "ptr", all, at);
      if (idOf(source) === wanted && !call(path("Carbon"), "TISSelectInputSource", ["ptr"], "i32", source))
        console.log(before);
    }
  }
  return Bun.spawnSync([process.execPath, "-e", `(${select})(${JSON.stringify(id)})`])
    .stdout.toString()
    .trim();
}
const mac = isMac && {
  send(returns: string, receiver: unknown, selector: string, ...typed: [string, unknown][]) {
    const objc = "/usr/lib/libobjc.A.dylib";
    if (typeof receiver === "string") receiver = bind(objc, "objc_getClass", ["ptr"], "ptr")(cString(receiver));
    const send = bind(objc, "objc_msgSend", ["ptr", "ptr", ...typed.map(it => it[0])], returns);
    return send(receiver, bind(objc, "sel_registerName", ["ptr"], "ptr")(cString(selector)), ...typed.map(it => it[1]));
  },
  graphics: (name: string, returns: string, ...typed: [string, unknown][]) =>
    bind(
      framework("CoreGraphics"),
      name,
      typed.map(it => it[0]),
      returns,
    )(...typed.map(it => it[1])),
  windowNumber() {
    const view = Number(window.getNativeWindowHandle().readBigUInt64LE());
    return Number(this.send("i64", this.send("ptr", view, "window"), "windowNumber"));
  },
  post(event: unknown) {
    const application = this.send("ptr", "NSApplication", "sharedApplication");
    this.send("void", application, "postEvent:atStart:", ["ptr", event], ["bool", false]);
  },
  /** Core Graphics would look up the characters, which only works on the main thread. */
  key(code: number, flags = 0) {
    const selector =
      "keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:";
    const plain = { 0: "a", 9: "v", 14: "e", 38: "j", 40: "k", 51: "\x7f", 53: "\x1b", 36: "\r" }[code]!;
    const string = (text: string): [string, unknown] => [
      "ptr",
      this.send("ptr", "NSString", "stringWithUTF8String:", ["ptr", cString(text)]),
    ];
    const characters = [string(flags & (1 << 19) ? "" : plain), string(plain)];
    // On arm64 the last two are next to each other on the stack.
    const last: [string, unknown][] =
      process.arch === "arm64"
        ? [["u32", code << 16]]
        : [
            ["bool", false],
            ["u16", code],
          ];
    const place: [string, unknown][] = [
      ["f64", 0],
      ["f64", 0],
      ["u64", flags],
      ["f64", 0],
      ["i64", this.windowNumber()],
      ["ptr", null],
    ];
    for (const type of [10, 11])
      this.post(this.send("ptr", "NSEvent", selector, ["u64", type], ...place, ...characters, ...last));
  },
  click(x: number, y: number) {
    const selector =
      "mouseEventWithType:location:modifierFlags:timestamp:windowNumber:context:eventNumber:clickCount:pressure:";
    const at: [string, unknown][] = [
      ["f64", x],
      ["f64", window.getBounds().height - y],
    ];
    const rest: [string, unknown][] = [
      ["i64", this.windowNumber()],
      ["ptr", null],
      ["i64", 0],
      ["i64", 1],
      ["f32", 1],
    ];
    for (const type of [1, 2]) {
      this.post(this.send("ptr", "NSEvent", selector, ["u64", type], ...at, ["u64", 0], ["f64", 0], ...rest));
    }
  },
  mouse(type: number, [x, y]: number[]) {
    const event = this.graphics(
      "CGEventCreateMouseEvent",
      "ptr",
      ["ptr", null],
      ["u32", type],
      ["f64", x],
      ["f64", y],
      ["u32", 0],
    );
    this.graphics("CGEventPost", "void", ["u32", 0], ["ptr", event]);
    return Bun.sleep(50);
  },
  windowLevels() {
    const windows = this.graphics("CGWindowListCopyWindowInfo", "ptr", ["u32", 1], ["u32", 0]);
    const key = this.send("ptr", "NSString", "stringWithUTF8String:", ["ptr", cString("kCGWindowLayer")]);
    const comma = this.send("ptr", "NSString", "stringWithUTF8String:", ["ptr", cString(",")]);
    const joined = this.send(
      "ptr",
      this.send("ptr", windows, "valueForKey:", ["ptr", key]),
      "componentsJoinedByString:",
      ["ptr", comma],
    );
    return String(this.send("cstring", joined, "UTF8String")).split(",");
  },
  /** What the window server has, which a process may see of its own windows. */
  capture(width: number, height: number) {
    const nowhere: [string, unknown][] = [
      ["f64", Infinity],
      ["f64", Infinity],
      ["f64", 0],
      ["f64", 0],
    ];
    const options: [string, unknown][] = [
      ["u32", 8],
      ["u32", this.windowNumber()],
      ["u32", 1 | 8],
    ];
    const image = this.graphics("CGWindowListCreateImage", "ptr", ...nowhere, ...options);
    if (!image) return;
    const create = bind(framework("CoreFoundation"), "CFStringCreateWithCString", ["ptr", "ptr", "u32"], "ptr");
    const name = create(null, cString("kCGColorSpaceSRGB"), 0x600);
    const space = this.graphics("CGColorSpaceCreateWithName", "ptr", ["ptr", name]);
    const pixels = new Uint8ClampedArray(width * height * 4);
    const layout: [string, unknown][] = [width, height, 8, width * 4].map(it => ["u64", it]);
    const context = this.graphics(
      "CGBitmapContextCreate",
      "ptr",
      ["ptr", ptr(pixels)],
      ...layout,
      ["ptr", space],
      ["u32", 1],
    );
    const area: [string, unknown][] = [0, 0, width, height].map(it => ["f64", it]);
    this.graphics("CGContextDrawImage", "void", ["ptr", context], ...area, ["ptr", image]);
    for (const object of [context, space, name, image])
      bind(framework("CoreFoundation"), "CFRelease", ["ptr"], "void")(object);
    return pixels;
  },
};

/** A `rusage_info_v2`. */
function usage() {
  const all = new BigUint64Array(40);
  if (isMac)
    bind("/usr/lib/libSystem.B.dylib", "proc_pid_rusage", ["i32", "i32", "ptr"], "i32")(process.pid, 2, ptr(all));
  return all;
}

/** What Activity Monitor shows, in MB. */
const footprint = () => Math.round((isMac ? Number(usage()[9]) : process.memoryUsage.rss()) / 2 ** 20);

async function compareWithScreen(name: string) {
  await frame();
  await Bun.sleep(150);
  log("INFO footprint", name, footprint(), "MB");
  // The pictures take more memory than everything else.
  if (process.env.SELFTEST_PICTURES === "0") return;
  const page = await window.capturePage();
  await Bun.write(file(name + ".page.png"), page.toPNG());
  if (!mac) return;
  const { OffscreenCanvas, ImageData, Blob } = window.window as any;
  const bitmap = await (window.window as any).createImageBitmap(new Blob([page.toPNG()], { type: "image/png" }));
  const { width, height } = bitmap;
  const shown = await Promise.try(() => mac.capture(width, height)).catch(error => log(error));
  if (!shown) return check(`${name}: the window can be captured`, false);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const wanted = context.getImageData(0, 0, width, height).data;
  let [different, opaque] = [0, 0];
  for (let at = 0; at < wanted.length; at += 4) {
    const off = (channel: number) => Math.abs(wanted[at + channel] - shown[at + channel]);
    if (shown[at + 3] === 255) opaque++;
    if (shown[at + 3] === 255 && Math.max(off(0), off(1), off(2)) > 12) different++;
  }
  // The buttons of the window are not part of the page.
  check(
    `${name}: the screen shows the page`,
    opaque > width * height * 0.9 && different < 4000 * window.devicePixelRatio ** 2,
    different,
    "pixels differ,",
    opaque,
    "are opaque",
  );
  context.putImageData(new ImageData(shown, width, height), 0, 0);
  await Bun.write(file(name + ".screen.png"), await (await canvas.convertToBlob()).arrayBuffer());
}

log("INFO RSS before bun:desktop", before, "MB");
let chosen = "";
const item = (label: string, accelerator?: string) => ({
  label,
  accelerator,
  click: () => log("chose", (chosen = label)),
});
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "Test", submenu: [item("Free", "Cmd+J"), item("Taken", "Cmd+K"), { role: "close" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help", submenu: [item("Help")] },
  ]),
);
const popUp = (callback?: () => void) => {
  const menu = Menu.buildFromTemplate([item("One"), { type: "separator" }, { label: "More", submenu: [item("Two")] }]);
  menu.popup({ window, x: 200, y: 200, callback });
  return menu;
};
document.addEventListener("keydown", (event: any) => event.metaKey && event.key === "k" && event.preventDefault());

await frame();
log("INFO first frame after", Math.round(process.uptime() * 1000), "ms");
const [field, list, spinner] = ["textarea", "#list", "#spinner"].map(it => document.querySelector(it) as any);

if (mode === "run-try") {
  spinner.style.animationPlayState = "running";
  window.on("context-menu", () => popUp());
  window.on("closed", () => app.exit(0));
  document.querySelector("a")!.addEventListener("click", async () => {
    log(await dialog.showOpenDialog(window, { properties: ["openDirectory"] }));
    log(await dialog.showMessageBox(window, { message: "A sheet", buttons: ["OK", "Cancel"], checkboxLabel: "Check" }));
    log(dialog.showMessageBoxSync({ message: "On its own", buttons: ["OK"] }));
  });
  log("Resize, scroll, type, open menus, click the link. The gray square has to keep spinning.");
  await new Promise(() => {});
}

check("it has the focus", await until(() => window.isFocused()));
field.style.caretColor = "transparent";
await compareWithScreen("start");
if (mac) {
  const COMMAND = 1 << 20;
  mac.key(0);
  check("a key types", await until(() => field.value !== ""), JSON.stringify(field.value));
  mac.key(51);
  check("Delete deletes", await until(() => field.value === ""));
  mac.key(14, 1 << 19);
  mac.key(14);
  await until(() => field.value === "é", 500);
  log("INFO Option-E and E type", JSON.stringify(field.value));
  mac.key(38, COMMAND);
  check("a shortcut reaches the menu", await until(() => chosen === "Free"));
  mac.key(40, COMMAND);
  check("unless the page takes it", !(await until(() => chosen === "Taken", 300)));
  clipboard.write({ text: "plain", html: "<b>rich</b>" });
  check("clipboard", clipboard.readText() === "plain" && clipboard.readHTML().includes("<b>rich</b>"));
  field.value = "";
  mac.key(9, COMMAND);
  await until(() => field.value !== "");
  await Bun.sleep(100);
  check("it pastes once", field.value === "plain", JSON.stringify(field.value));
  const japanese = "com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese";
  async function composes() {
    const usual = selectInputSource(japanese);
    if (!usual) return false;
    let did = false;
    field.addEventListener("compositionupdate", () => (did = true), { once: true });
    await Bun.sleep(700);
    for (const code of [40, 0]) mac.key(code);
    await until(() => did);
    for (const code of [53, 53]) mac.key(code);
    await Bun.sleep(300);
    selectInputSource(usual);
    return did;
  }
  if (await composes()) {
    popUp(() => {});
    field.select();
    await Bun.sleep(500);
    mac.key(53);
    await Bun.sleep(500);
    check("an input method composes after a menu", await composes(), JSON.stringify(field.value));
  } else log("INFO input methods are not tested: Japanese (Romaji) is not enabled, or does not take these keys");
  let clicked: any;
  list.addEventListener("click", (event: any) => (clicked = event));
  mac.click(700, 100);
  check("a click lands", (await until(() => clicked)) && clicked.clientX === 700 && clicked.clientY === 100);

  let [isClosed, ticks] = [false, 0];
  const menu = popUp(() => (isClosed = true));
  for (const end = performance.now() + 500; performance.now() < end; ticks++) await frame();
  check("frames go on while a menu is open", ticks > 15 && !isClosed, ticks);
  menu.closePopup();
  const controller = new AbortController();
  const answer = dialog.showMessageBox(window, { message: "Closes by itself", signal: controller.signal });
  await Bun.sleep(600);
  controller.abort();
  check("a sheet can be closed", await Promise.race([answer, Bun.sleep(2000)]));
  await Bun.sleep(400);
}

spinner.style.animationPlayState = "running";
await watch("a square spins");
await measure("animation", 120, () => {});
spinner.style.animation = "none";
await measure("scrollTop", 180, index => (list.scrollTop = index * 20));
await compareWithScreen("scrolled");
await measure("wheel", 180, () => window.sendInputEvent({ type: "mouseWheel", x: 700, y: 300, deltaX: 0, deltaY: 7 }));
await compareWithScreen("wheeled");
await measure("everything", 120, index => (document.body.style.background = `hsl(${index * 3} 40% 80%)`));
await compareWithScreen("repainted");
await measure("resize", 40, index => window.setSize(900 + index * 7, 700 + index * 2));
await compareWithScreen("resized");
window.maximize();
check("it zooms", await until(() => window.isMaximized(), 2000));
await Bun.sleep(500);
list.style.cssText = "position: fixed; inset: 44px 0 0; background: Canvas";
await measure("wheel, zoomed", 180, () =>
  window.sendInputEvent({ type: "mouseWheel", x: 700, y: 300, deltaX: 0, deltaY: -9 }),
);
await compareWithScreen("zoomed");
window.unmaximize();
await until(() => !window.isMaximized(), 2000);

if (mac) {
  const after = (name: string, action: () => void) => {
    let hasHappened = false;
    window.once(name as any, () => (hasHappened = true));
    action();
    return until(() => hasHappened, 3000);
  };
  check("full screen", await after("enter-full-screen", () => window.setFullScreen(true)));
  await compareWithScreen("full-screen");
  check("and back", await after("leave-full-screen", () => window.setFullScreen(false)));
  check("it minimizes", await after("minimize", () => window.minimize()));
  check("and comes back", await after("restore", () => window.restore()));
  await Bun.sleep(700);
  await compareWithScreen("restored");
  const sheet = new Window({ parent: window, modal: true, show: false, width: 300, height: 120 });
  sheet.document.body.textContent = "A sheet";
  check("a sheet waits", window.isFocused());
  sheet.show();
  check("takes the focus", await until(() => sheet.isFocused(), 3000));
  sheet.close();
  check("and gives it back", await until(() => window.isFocused(), 3000));
  new Window({ parent: window, modal: true, width: 300, height: 120 }).close();
  check("also if it closes at once", await until(() => window.isFocused(), 3000));
  async function hasRed(element: any) {
    const { OffscreenCanvas, Blob } = window.window as any;
    const { x, y, width, height } = element.getBoundingClientRect();
    const bitmap = await (window.window as any).createImageBitmap(
      new Blob([(await window.capturePage({ x, y, width, height })).toPNG()]),
    );
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return data.some(
      (red: number, at: number) => at % 4 === 0 && red > 200 && data[at + 1] < 110 && data[at + 2] < 110,
    );
  }
  list.removeAttribute("style");
  const editor: any = field.parentNode.appendChild(document.createElement("div"));
  editor.contentEditable = "true";
  for (const it of [editor, field]) {
    it.focus();
    document.execCommand("selectAll");
    document.execCommand("insertText", false, "There are two mistakes: helllo and wrold ");
    let isMarked = false;
    for (let i = 0; i < 20 && !isMarked; i++) {
      await Bun.sleep(400);
      isMarked = await hasRed(it);
    }
    check(`spelling in a ${it.localName}`, isMarked);
  }
  editor.remove();
  if (mac.graphics("CGPreflightPostEventAccess", "bool")) {
    const source: any = field.parentNode.appendChild(document.createElement("span"));
    source.textContent = "Dragged";
    source.style.userSelect = "text";
    const middle = (it: any) => {
      const [{ x, y, width, height }, content] = [it.getBoundingClientRect(), window.getContentBounds()];
      return [content.x + x + width / 2, content.y + y + height / 2];
    };
    for (const [target, effect] of [
      [field, "copy"],
      [list, "none"],
    ] as any) {
      const [from, to] = [middle(source), middle(target)];
      let [ended, levels] = ["", new Set<string>()];
      source.addEventListener("dragend", (event: any) => (ended = event.dataTransfer.dropEffect), { once: true });
      (window.window as any).getSelection().selectAllChildren(source);
      for (const type of [5, 1]) await mac.mouse(type, from);
      for (let step = 1; step <= 12; step++) {
        await mac.mouse(
          6,
          from.map((it, axis) => it + ((to[axis] - it) * step) / 12),
        );
        for (const it of mac.windowLevels()) levels.add(it);
      }
      await Bun.sleep(300);
      await mac.mouse(2, to);
      check("what is dragged has an image", levels.has("500"), "levels of windows:", [...levels].join());
      check(`and ends with ${effect}`, await until(() => ended === effect, 3000), ended);
    }
    check("and was dropped once", field.value.split("Dragged").length === 2, field.value);
    source.remove();
  } else log("INFO drags are not tested, the mouse may not be moved");
  const tray = new Tray((await window.capturePage({ x: 100, y: 0, width: 9, height: 9 })).toPNG());
  await Bun.sleep(300);
  check("tray", tray.getBounds().height > 10 && tray.getBounds().height < 50, JSON.stringify(tray.getBounds()));
  const menu = Menu.buildFromTemplate([item("One")]);
  tray.popUpContextMenu(menu);
  await Bun.sleep(500);
  const isClosed = new Promise(resolve => menu.once("menu-will-close", () => resolve(true)));
  mac.key(53);
  check("its menu", await Promise.race([isClosed, Bun.sleep(1500)]));
  tray.closeContextMenu();
  tray.destroy();
  const { name, icon } = await require("bun:desktop/electron").app.getApplicationInfoForProtocol("https://");
  log("INFO browser", name, JSON.stringify(icon.getSize()), app.getPreferredSystemLanguages(), app.getSystemLocale());
}

let late = 0;
for (let index = 0; index < 20; index++) {
  const before = performance.now();
  await Bun.sleep(10);
  late = Math.max(late, performance.now() - before - 10);
}
check("timers", late < 10, `late by up to ${late.toFixed(1)} ms`);
await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
check("fetch and spawn", (await (await fetch(server.url)).text()) + (await Bun.$`echo ok`.text()) === "okok\n");
window.hide();
await Bun.sleep(300);
window.show();
await Bun.sleep(300);
await compareWithScreen("shown-again");
await Bun.sleep(4500);
document.querySelector("textarea")!.focus();
await watch("the caret blinks");
log("INFO footprint at rest", footprint(), "MB");
Bun.gc(true);
await Bun.sleep(500);
log("INFO footprint after a collection", footprint(), "MB");
if (isMac) await Bun.write(file("footprint.txt"), Bun.spawnSync(["footprint", String(process.pid)]).stdout);
app.exit(0);
