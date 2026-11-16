// The picture of a window from the last run, which is on the screen until the app has painted.
const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const { allocateSurfaceId, surfaces, trap } = require("internal/desktop/surfaces");
const { app } = require("internal/desktop/app");

type Input = { t: string; s: number; [key: string]: any };
type Rect = { x: number; y: number; width: number; height: number };
type Covered = { uncovered(): void };

const WINDOW = 1;
const COVER_TIMEOUT = 10_000;
// The app may move `userData` later on.
const directory: string = app.getPath("userData");
const description = path.join(directory, "LaunchCover.json");
const owner = path.join(directory, "LaunchCover.owner");
const picture = () => path.join(app.getPath("userData"), "LaunchCover");
const edits = /^(?:.|Backspace|Delete|Enter|Shift|Dead|Process|Arrow\w+|Home|End)$/u;
const SHIFT = 1;
const ALT = 4;
const ALT_GRAPH = 16;
const CAPS_LOCK = 32;
const typing = SHIFT | ALT_GRAPH | CAPS_LOCK | (process.platform === "darwin" ? ALT : 0);
const isPossible = () =>
  Bun.isMainThread && process.env.BUN_DESKTOP_LAUNCH_COVER !== "0" && native.resourcesPath() !== null;

let isShown = false;
let isReserved = false;
let isOwner = false;
let generation = 0;
let timer: Timer | undefined;
let covered: Covered | undefined;
let early: string[] = [];
let inputs: Input[] = [];
let isComposing = false;
let isPressed = false;
let wantsEnd: Rect[] | undefined;
/** Only parts are pictured. */
let isPartial = false;
/** What was typed is in the field, which has yet to be rendered. */
let isHandingOver = false;
let typesInto = 0;
let received = 0;

function own(state: string) {
  fs.writeFileSync(owner, `${process.pid} ${state}`, { mode: 0o600 });
  if (isOwner) return;
  isOwner = true;
  process.once("exit", () => fs.rmSync(owner, { force: true }));
}

function isRunning(pid: number) {
  try {
    return pid !== process.pid && process.kill(pid, 0);
  } catch {
    return false;
  }
}

function begin() {
  if (isOwner || !isPossible() || !fs.existsSync(description)) return;
  try {
    const [pid, state] = fs.existsSync(owner) ? fs.readFileSync(owner, "latin1").split(" ") : [];
    if (pid && isRunning(+pid)) return;
    if (state === "launching") {
      fs.rmSync(owner, { force: true });
      return clear();
    }
    own("launching");
  } catch {
    return;
  }
  const surface = allocateSurfaceId();
  surfaces.$set(surface, hold);
  native.startWith("cover.show", { path: description, window: WINDOW, surface });
  isShown = isReserved = true;
  wait(6);
  app.once("open-url", () => end(false));
  app.once("open-file", () => end(false));
}

function wait(times: number) {
  timer = setTimeout(
    () => (times > 1 && typed(inputs).length > 0 ? wait(times - 1) : end(false)),
    COVER_TIMEOUT,
  ).unref();
}

function hold(event: Input) {
  if (event.t === "text" || (event.t === "key" && event.e === "down")) received++;
  if (isPartial && (event.t === "outside" || event.t === "wheel")) return end(true);
  const eventT = event.t;
  if (eventT === "compose" || eventT === "composeEnd") isComposing = eventT === "compose";
  else if (event.t === "mouse") {
    if (event.e !== "down" && event.e !== "up") return;
    isPressed = event.buttons !== 0;
  } else if (event.t !== "key" && event.t !== "text") return;
  if (!isShown && event.t === "mouse") return;
  if (event.t !== "mouse" && (!isShown || isPartial || (isHandingOver && inputs.length === 0)))
    return type([event], typesInto);
  inputs.push(event);
  if (waitsForInput && hasInput()) waitsForInput = void waitsForInput.resolve();
  if (wantsEnd) end(true, wantsEnd);
}

let waitsForInput: PromiseWithResolvers<void> | undefined;
function whenInput(): Promise<void> {
  return !isShown || hasInput() ? Promise.$resolve() : (waitsForInput ??= Promise.withResolvers()).promise;
}

function type(events: Input[], surface: number) {
  for (const event of events) {
    if (event.t === "key" && (!edits.test(event.key) || (event.m & ~typing) !== 0)) continue;
    surfaces.$get(surface)?.({ ...event, s: surface, range: null });
  }
}

const acceptsText = (surface: number | null) => !!surface && native.ask("cover.acceptsText", surface);

function forget() {
  isShown = isPartial = false;
  inputs = [];
  clearTimeout(timer);
  waitsForInput?.resolve();
  launched();
}

function launched() {
  try {
    own("running");
  } catch {}
}

function lastClick(held: Input[]) {
  const click = held.findLastIndex(it => it.t === "mouse" && it.e === "down" && it.n <= 1);
  return click >= 0 && held[click].b === 0 ? click : -1;
}

function hasInput(): boolean {
  const click = lastClick(inputs);
  return click < 0 ? inputs.some(it => it.t !== "mouse") : native.ask("cover.fits", [inputs[click].x, inputs[click].y]);
}

/** Text is only typed into a field, and only the last click is made, if it hits what the user saw. */
function end(replays: boolean, keep: Rect[] = []) {
  if (!isShown) return;
  if (!covered) return discard();
  if (replays && (isComposing || isPressed || isHandingOver)) return void (wantsEnd = keep);
  wantsEnd = undefined;
  if (!replays || lastClick(inputs) >= 0) return finish(replays, keep);
  const tasks = require("internal/desktop/tasks");
  let focused = native.ask("cover.focused");
  if (!isPartial && typed(inputs).length > 0 && !acceptsText(focused)) {
    // An editor may ask for another frame to take the focus in.
    tasks.render();
    focused = native.ask("cover.focused");
  }
  if (!isPartial) typesInto = acceptsText(focused) ? focused : 0;
  if (typesInto === 0) return finish(true, keep);
  if (typed(inputs).length === 0) {
    // The picture shows what is still on its way.
    if (!isPartial && native.ask("cover.sent") !== received) return void (wantsEnd = keep);
    return finish(true, keep);
  }
  isHandingOver = true;
  type(typed(inputs.splice(0)), typesInto);
  tasks.post(tasks.BLOCKING, () => {
    tasks.render();
    isHandingOver = false;
    end(true, wantsEnd ?? keep);
  });
}

const typed = (events: Input[]) => events.filter(it => it.t !== "mouse");

function finish(replays: boolean, keep: Rect[]) {
  const held = replays ? inputs : [];
  const click = lastClick(held);
  if (click >= 0 && keep.length > 0) {
    if (!hasInput()) return;
    keep = [];
  }
  inputs = [];
  if (!isPartial) covered!.uncovered();
  const { clicked, focused } = native.ask("cover.end", {
    point: click < 0 ? null : [held[click].x, held[click].y],
    keep,
  });
  if (keep.length === 0) forget();
  else if (!isPartial) {
    isPartial = true;
    launched();
  }
  if (!replays) return;
  if (acceptsText(focused)) type(typed(click < 0 ? held : held.slice(0, click)), (typesInto = focused));
  if (click < 0) return;
  typesInto = 0;
  if (!clicked) return;
  const rest = held.slice(click);
  const handle = surfaces.$get(clicked.s);
  handle?.({ ...rest[0], ...clicked, e: "move", buttons: 0, n: 0 });
  for (const event of rest) if (event.t === "mouse") handle?.({ ...event, ...clicked });
  let tries = 20;
  (function typeRest() {
    const clickedS = clicked.s;
    if (acceptsText(clickedS)) type(typed(rest), clickedS);
    else if (--tries > 0 && typed(rest).length > 0) setTimeout(typeRest, 16);
  })();
}

let earlyKeys: Input[] = [];
function dropKeys() {
  trap.early = null;
  clearTimeout(timer);
  return earlyKeys.splice(0);
}

/** Without a picture, what is typed waits for the field all the same. */
function holdKeys() {
  if (!isPossible()) return;
  timer = setTimeout(dropKeys, COVER_TIMEOUT).unref();
  trap.early = (event: Input) => {
    if (event.t === "mouse" || event.key === "Tab") {
      if (event.e === "down") dropKeys();
      return false;
    }
    const eventS = event.s;
    if (acceptsText(eventS)) {
      type(dropKeys(), eventS);
      return false;
    }
    if (event.t === "key" && (event.key === "Enter" || !edits.test(event.key) || (event.m & ~typing) !== 0))
      return false;
    if (earlyKeys.push(event) === 1) setTimeout(typeEarlyKeys, 16).unref();
    // The page may listen for keys.
    return event.t === "text";
  };
}

function typeEarlyKeys() {
  if (earlyKeys.length === 0) return;
  for (const surface of surfaces.$keys()) if (acceptsText(surface)) return type(dropKeys(), surface);
  setTimeout(typeEarlyKeys, 16).unref();
}

function releaseKeys(replays: boolean) {
  if (trap.early === null) return;
  if (!replays || earlyKeys.length === 0) return void dropKeys();
  clearTimeout(timer);
  timer = setTimeout(dropKeys, 500).unref();
}

function discard() {
  if (!isShown || covered) return;
  native.send("cover.discard");
  forget();
}

/** The id of the window that has the option `launchCover`. */
function takeId() {
  if (!isReserved) return 0;
  isReserved = false;
  return WINDOW;
}

/** Returns the events that the window has missed, if it exists already. */
function adopt(options: object, window: Covered) {
  if (!isShown) return;
  if (!native.ask("cover.adopt", options)) return forget();
  covered = window;
  return early;
}

function missed(event: { w: number; e: string }) {
  if (isShown && event.w === WINDOW) early.push(event.e);
}

let saving: Promise<unknown> = Promise.$resolve();
function save(details: object): Promise<boolean> {
  const wanted = generation;
  const next = saving.then(async () => {
    if (isShown || wanted !== generation || !isPossible()) return false;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!isOwner) own("running");
    const theme = require("internal/desktop/system").api.nativeTheme.themeSource;
    await native.request("cover.save", { ...details, path: description, picture: picture(), theme });
    if (wanted !== generation) clear();
    return wanted === generation;
  });
  return (saving = next.catch(() => {
    clear();
    return false;
  }));
}

function clear() {
  generation++;
  fs.rmSync(description, { force: true });
  fs.rmSync(picture(), { force: true });
  fs.rmSync(picture() + ".font", { force: true });
}

export default {
  adopt,
  begin,
  clear,
  discard,
  end,
  firstFreeId: () => (isReserved ? WINDOW + 1 : 1),
  hasInput,
  holdKeys,
  releaseKeys,
  whenInput,
  isShownIn: (id: number) => isShown && covered !== undefined && id === WINDOW,
  isSaved: () => fs.existsSync(description),
  missed,
  save,
  takeId,
};
