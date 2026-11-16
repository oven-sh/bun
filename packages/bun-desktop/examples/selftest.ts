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
    mode === "try" ? 600_000 : 90_000,
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
  for (const renderer of isMac ? ["layers", "software", "gpu"] : ["software", "gpu"]) {
    for (const threads of ["2", "1"]) {
      await run(`${renderer}-${threads}`, mode, { BUN_DESKTOP_RENDERER: renderer, BUN_DESKTOP_THREADS: threads });
    }
  }
}
if (!mode.startsWith("run-")) process.exit(0);

process.on("uncaughtException", error => console.log("FAIL", error) ?? process.exit(1));
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
}

const cString = (text: string) => Buffer.from(text + "\0");
function bind(library: string, name: string, args: string[], returns: string): (...values: any[]) => any {
  return (dlopen(library, { [name]: { args, returns } } as any).symbols as any)[name];
}
const framework = (name: string) => `/System/Library/Frameworks/${name}.framework/${name}`;
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
  key(code: number, flags = 0) {
    for (const isDown of [true, false]) {
      const event = this.graphics("CGEventCreateKeyboardEvent", "ptr", ["ptr", null], ["u16", code], ["bool", isDown]);
      this.graphics("CGEventSetFlags", "void", ["ptr", event], ["u64", flags]);
      this.post(this.send("ptr", "NSEvent", "eventWithCGEvent:", ["ptr", event]));
    }
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
    return pixels;
  },
};

async function compareWithScreen(name: string) {
  await frame();
  await Bun.sleep(150);
  const page = await window.capturePage();
  await Bun.write(file(name + ".page.png"), page.toPNG());
  if (!mac) return;
  const { OffscreenCanvas, ImageData, Blob, createImageBitmap } = window.window as any;
  const bitmap = await createImageBitmap(new Blob([page.toPNG()], { type: "image/png" }));
  const { width, height } = bitmap;
  const shown = await Promise.try(() => mac.capture(width, height)).catch(error => log(error));
  if (!shown) return log("INFO", name, "the window cannot be captured");
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const wanted = context.getImageData(0, 0, width, height).data;
  let different = 0;
  for (let at = 0; at < wanted.length; at += 4) {
    const off = (channel: number) => Math.abs(wanted[at + channel] - shown[at + channel]);
    if (shown[at + 3] === 255 && Math.max(off(0), off(1), off(2)) > 12) different++;
  }
  // The buttons of the window are not part of the page.
  check(
    `${name}: the screen shows the page`,
    different < 4000 * window.devicePixelRatio ** 2,
    different,
    "pixels differ",
  );
  context.putImageData(new ImageData(shown, width, height), 0, 0);
  await Bun.write(file(name + ".screen.png"), await (await canvas.convertToBlob()).arrayBuffer());
}

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
  const before = clipboard.readText();
  clipboard.write({ text: "plain", html: "<b>rich</b>" });
  check("clipboard", clipboard.readText() === "plain" && clipboard.readHTML().includes("<b>rich</b>"));
  field.value = "";
  mac.key(9, COMMAND);
  await until(() => field.value !== "");
  await Bun.sleep(100);
  check("it pastes once", field.value === "plain", JSON.stringify(field.value));
  clipboard.writeText(before);
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
const idle = process.cpuUsage();
await Bun.sleep(2000);
const { user, system } = process.cpuUsage(idle);
log(`INFO idle for 2 s: CPU ${((user + system) / 1000).toFixed(1)} ms, RSS ${process.memoryUsage.rss() >> 20} MB`);
if (isMac)
  log(
    "INFO",
    Bun.spawnSync(["footprint", String(process.pid)])
      .stdout.toString()
      .match(/Footprint: .*/)?.[0],
  );
app.exit(0);
