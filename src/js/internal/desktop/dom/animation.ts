// Web Animations. The engine has the animations and their timing.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const engine = require("internal/desktop/dom/engine");
const { canonicalValue, longhandsOf, styleOf } = require("internal/desktop/dom/cssom");
const { Element, iterable, kList, makeList } = require("internal/desktop/dom/node");
const drainMicrotasks = $bindgen("desktop.bind.ts", "drainMicrotasks");
const typed = () => require("internal/desktop/dom/typed");

const { domError, expose, invalidate, sync, wrapOrNull } = core;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

const enum Op {
  Play,
  Pause,
  Cancel,
  Finish,
  Reverse,
  SetCurrentTime,
  SetStartTime,
  SetPlaybackRate,
  UpdatePlaybackRate,
  Persist,
  Release,
}
const enum At {
  PlayState,
  CurrentTime,
  StartTime,
  PlaybackRate,
  Pending,
  ReplaceState,
  Progress,
  CurrentIteration,
  EndTime,
  ActiveDuration,
  Timeline,
  TimelineTime,
  Duration,
  Overridden,
  Composite,
  Timing,
}
const enum State {
  Idle,
  Running,
  Paused,
  Finished,
}
const OF_DOCUMENT = 0xffffffff;
const KEYFRAMES_ARE_OVERRIDDEN = 1 << 8;
const ALL_MEMBERS = 0xff;

const fills = ["none", "forwards", "backwards", "both"];
const directions = ["normal", "reverse", "alternate", "alternate-reverse"];
const orNull = (value: number) => (value === value ? value : null);

const composites = ["replace", "add", "accumulate"];
const rangeNames = ["cover", "contain", "entry", "exit", "entry-crossing", "exit-crossing", "scroll"];

class Keyframe {
  /** In `range`, if it has one. */
  offset: number | null = null;
  range = "";
  computedOffset = 0;
  easing = "linear";
  composite = "auto";
  /** Pairs of the name of a property in CSS and its value. */
  values: string[] = [];
}

function oneOf(value: unknown, all: string[], type: string): string {
  const text = `${value}`;
  if (!all.includes(text))
    throw new TypeError(`The provided value '${text}' is not a valid enum value of type ${type}.`);
  return text;
}

function finite(value: unknown): number {
  const number = +(value as number);
  if (!Number.isFinite(number)) throw new TypeError("The provided double value is non-finite.");
  return number;
}

function validEasing(easing: string): string {
  const parsed = easing === "linear" ? easing : engine.parseEasing(easing);
  if (parsed === "") throw new TypeError(`'${easing}' is not a valid value for easing`);
  return parsed;
}

const validComposite = (composite: unknown) => oneOf(composite, [...composites, "auto"], "CompositeOperationOrAuto");

function setOffset(frame: Keyframe, offset: any) {
  if (offset == null) return;
  if (typeof offset === "number") return void (frame.offset = finite(offset));
  if ($isObject(offset)) {
    const { offset: percentage, rangeName = "none" } = offset;
    const name = oneOf(rangeName, ["none", ...rangeNames], "TimelineRange");
    if (!typed().isPercentage(percentage)) throw new TypeError("The offset must be a percentage.");
    offset = `${name === "none" ? "" : name} ${percentage}`;
  }
  const [range, fraction] = engine.parseKeyframeOffset(`${offset}`);
  if (fraction === undefined) throw new TypeError("The offset is not valid.");
  frame.range = range;
  frame.offset = +fraction;
}

function spread(frames: Keyframe[]): Keyframe[] {
  const plain = frames.filter(frame => frame.range === "");
  const offsets = plain.map(frame => frame.offset);
  let previous = -Infinity;
  for (const offset of offsets) {
    if (offset === null) continue;
    if (offset < previous) throw new TypeError("Offsets must be monotonically non-decreasing.");
    if ((previous = offset) < 0 || offset > 1) throw new TypeError("Offsets must be null or in the range [0,1].");
  }
  if (plain.length > 1) offsets[0] ??= 0;
  if (plain.length > 0) offsets[plain.length - 1] ??= 1;
  for (let known = 0, i = 1; i < plain.length; i++) {
    if (offsets[i] === null) continue;
    for (let j = known + 1; j < i; j++) {
      offsets[j] = offsets[known]! + ((offsets[i]! - offsets[known]!) * (j - known)) / (i - known);
    }
    known = i;
  }
  plain.forEach((frame, i) => (frame.computedOffset = offsets[i]!));
  return frames;
}

const cssNameOf = new Map<string, string>();

/** "" if it cannot be animated. */
function cssName(member: string): string {
  if (member.startsWith("--")) return member.length > 2 ? member : "";
  let name = cssNameOf.$get(member);
  if (name === undefined) {
    name = member.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^css-(?=float$|offset$)/, "");
    if (/^(?:[A-Z]|float$|offset$)|-/.test(member) || !engine.isAnimatable(name)) return "";
    cssNameOf.$set(member, name);
  }
  return name;
}

function memberName(name: string): string {
  if (name === "float" || name === "offset") name = "css-" + name;
  return name.startsWith("--") ? name : name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function setValue(frame: Keyframe, name: string, value: string) {
  const canonical = canonicalValue(name, value);
  if (canonical !== null) frame.values.push(name, canonical);
}

const animatableMembers = (object: object) =>
  Object.keys(object)
    .filter(member => cssName(member) !== "")
    .sort();

function listOf(value: any): unknown[] {
  if (value === undefined) return [];
  return $isObject(value) && value[Symbol.iterator] != null ? Array.from(value as unknown[]) : [value];
}

function normalizeKeyframes(input: any): Keyframe[] {
  if (input == null) return [];
  if (!$isObject(input)) throw new TypeError("Keyframes must be an object.");
  const iterate = input[Symbol.iterator];
  let frames: Keyframe[] = [];
  let unusedEasings: string[] = [];
  if (iterate != null) {
    for (const given of { [Symbol.iterator]: () => iterate.$call(input) } as Iterable<any>) {
      if (given != null && !$isObject(given)) throw new TypeError("Keyframes must be objects, or null or undefined.");
      const frame = new Keyframe();
      frames.push(frame);
      if (given == null) continue;
      const { composite = "auto", easing = "linear", offset } = given;
      frame.composite = validComposite(composite);
      frame.easing = `${easing}`;
      setOffset(frame, offset);
      for (const member of animatableMembers(given)) setValue(frame, cssName(member), `${given[member]}`);
    }
  } else {
    const operations = listOf(input.composite).map(validComposite);
    const easings = listOf(input.easing).map(it => `${it}`);
    const offsets = input.offset === null ? [] : listOf(input.offset);
    const byOffset = new Map<number, Keyframe>();
    for (const member of animatableMembers(input)) {
      const given = input[member];
      const values = given === undefined ? ["undefined"] : listOf(given).map(it => `${it}`);
      values.forEach((value, index) => {
        const at = values.length === 1 ? 1 : index / (values.length - 1);
        if (!byOffset.$has(at)) byOffset.$set(at, new Keyframe());
        setValue(byOffset.$get(at)!, cssName(member), value);
      });
    }
    frames = Array.from(byOffset.keys())
      .sort((a, b) => a - b)
      .map(at => byOffset.$get(at)!);
    frames.forEach((frame, index) => {
      setOffset(frame, offsets[index]);
      if (easings.length > 0) frame.easing = easings[index % easings.length];
      if (operations.length > 0) frame.composite = operations[index % operations.length];
    });
    unusedEasings = easings.slice(frames.length);
  }
  spread(frames);
  for (const frame of frames) frame.easing = validEasing(frame.easing);
  unusedEasings.forEach(validEasing);
  return frames;
}

/** What comes later wins. */
function declarations({ values }: Keyframe): string {
  if (values.length === 2) return values[0] + ":" + values[1];
  const weight = (name: string) =>
    (/(?:^|-)(?:block|inline|start|end)(?:-|$)/.test(name) ? 0.5 : 0) + longhandsOf(name).length;
  const at = values.map((_, index) => index).filter(index => index % 2 === 0);
  at.sort((a, b) => weight(values[b]) - weight(values[a]) || b - a);
  return at.map(index => values[index] + ":" + values[index + 1]).join(";");
}

function parseComputedKeyframes(parts: string[]): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i < parts.length; i++) {
    const frame = new Keyframe();
    setOffset(frame, parts[i]);
    frame.computedOffset = parts[i + 1] === "" ? NaN : +parts[i + 1];
    frame.easing = parts[i + 2];
    frame.composite = parts[i + 3];
    for (i += 4; parts[i] !== ""; i += 2) frame.values.push(parts[i], parts[i + 1]);
    frames.push(frame);
  }
  return frames;
}

class Timing {
  delay = 0;
  endDelay = 0;
  /** In percent, or else NaN. */
  relativeDelay = NaN;
  relativeEndDelay = NaN;
  /** Negative for "auto". */
  duration = -1;
  iterations = 1;
  iterationStart = 0;
  fill = "auto";
  direction = "normal";
  easing = "linear";
  /** With all the digits. */
  exactEasing = "linear";

  /** A bit for each member that is given. */
  update(options: any): number {
    if (options == null) return 0;
    const positive = (value: number, name: string) => {
      if (!(value >= 0)) throw new TypeError(name + " must be non-negative");
      return value;
    };
    if (!$isObject(options)) {
      this.duration = positive(+options, "duration");
      return 4;
    }
    let { delay, direction, duration, easing, endDelay, fill, iterationStart, iterations } = options;
    const relative = (value: any) =>
      $isObject(value) && typed().isPercentage(value) ? value.to("percent").value : NaN;
    const absolute = (value: any) =>
      !$isObject(value) || !typed().isNumeric(value)
        ? finite(value)
        : typed().isPercentage(value)
          ? 0
          : typed().milliseconds(value);
    const relativeDelay = delay === undefined ? this.relativeDelay : relative(delay);
    const relativeEndDelay = endDelay === undefined ? this.relativeEndDelay : relative(endDelay);
    if (delay !== undefined) delay = absolute(delay);
    if (direction !== undefined) direction = oneOf(direction, directions, "PlaybackDirection");
    if (endDelay !== undefined) endDelay = absolute(endDelay);
    if (fill !== undefined) fill = oneOf(fill, [...fills, "auto"], "FillMode");
    if (iterationStart !== undefined) iterationStart = positive(finite(iterationStart), "iterationStart");
    if (iterations !== undefined) iterations = positive(+iterations, "iterations");
    if (typeof duration === "number") positive(duration, "duration");
    else if ($isObject(duration) && typed().isNumeric(duration))
      duration = positive(typed().milliseconds(duration), "duration");
    else if (duration !== undefined) duration = `${duration}` === "auto" ? -1 : positive(NaN, "duration");
    const exact = easing === undefined ? this.exactEasing : `${easing}`;
    if (easing !== undefined) easing = validEasing(exact);
    this.exactEasing = exact;
    this.relativeDelay = relativeDelay;
    this.relativeEndDelay = relativeEndDelay;
    this.delay = delay ?? this.delay;
    this.endDelay = endDelay ?? this.endDelay;
    this.duration = duration ?? this.duration;
    this.iterations = iterations ?? this.iterations;
    this.iterationStart = iterationStart ?? this.iterationStart;
    this.fill = fill ?? this.fill;
    this.direction = direction ?? this.direction;
    this.easing = easing ?? this.easing;
    const given = [delay, endDelay, duration, iterations, iterationStart, fill, direction, easing];
    return given.reduce((bits, it, index) => (it === undefined ? bits : bits | (1 << index)), 0);
  }

  numbers(): number[] {
    const { delay, endDelay, duration, iterations, iterationStart } = this;
    const fill = Math.max(fills.indexOf(this.fill), 0);
    const direction = directions.indexOf(this.direction);
    return [
      delay,
      endDelay,
      duration,
      iterations,
      iterationStart,
      fill,
      direction,
      this.relativeDelay / 100 || 0,
      this.relativeEndDelay / 100 || 0,
    ];
  }

  setNumbers([delay, endDelay, duration, iterations, iterationStart, fill, direction]: number[]) {
    this.delay = delay;
    this.endDelay = endDelay;
    this.duration = duration;
    this.iterations = iterations;
    this.iterationStart = iterationStart;
    if (fill !== 0 || this.fill !== "auto") this.fill = fills[fill];
    this.direction = directions[direction];
  }

  toObject() {
    const { direction, duration, easing, fill, iterationStart, iterations, relativeDelay, relativeEndDelay } = this;
    const delay = relativeDelay === relativeDelay ? typed().percent(relativeDelay) : this.delay;
    const endDelay = relativeEndDelay === relativeEndDelay ? typed().percent(relativeEndDelay) : this.endDelay;
    return {
      delay,
      direction,
      duration: duration < 0 ? "auto" : duration,
      easing,
      endDelay,
      fill,
      iterationStart,
      iterations,
    };
  }
}

class Effect {
  js: object;
  target: N | null = null;
  pseudo: string | null = null;
  composite = "replace";
  frames: Keyframe[] = [];
  timing = new Timing();
  player: Player | null = null;

  constructor(js: object) {
    this.js = js;
  }
  /** Takes over what a style has changed. */
  refresh(withKeyframes: boolean) {
    const { player } = this;
    if (player === null || !player.isCss || !player.isLive) return;
    const state = player.state();
    this.timing.setNumbers(state.slice(At.Timing));
    this.composite = composites[state[At.Composite]];
    if (!withKeyframes || state[At.Overridden] & KEYFRAMES_ARE_OVERRIDDEN) return;
    this.frames = parseComputedKeyframes(player.doc.engine.computedKeyframes(player.id));
  }
  sendKeyframes({ doc, id }: Player) {
    const { frames } = this;
    const offsets = frames.map(frame => (frame.range === "" ? frame.computedOffset : frame.offset!));
    const blocks = frames.flatMap(frame => [frame.range, frame.easing, frame.composite, declarations(frame)]);
    doc.engine.setKeyframes(id, this.composite, offsets, blocks);
  }
}

class AnimationEffect {
  declare $impl: Effect;

  constructor() {
    if (new.target === AnimationEffect) core.illegalConstructor();
    this.$impl = new Effect(this);
  }
  getTiming() {
    this.$impl.refresh(false);
    return this.$impl.timing.toObject();
  }
  getComputedTiming() {
    this.$impl.refresh(false);
    const { timing, player } = this.$impl;
    const given = { ...timing.toObject(), fill: timing.fill === "auto" ? "none" : timing.fill };
    if (player === null) {
      const duration = Math.max(timing.duration, 0);
      const activeDuration = duration && timing.iterations && duration * timing.iterations;
      const endTime = Math.max(0, timing.delay + activeDuration + timing.endDelay);
      return { ...given, duration, activeDuration, currentIteration: null, endTime, localTime: null, progress: null };
    }
    player.revive();
    const state = player.state();
    return {
      ...given,
      duration: player.time(At.Duration),
      activeDuration: player.time(At.ActiveDuration),
      currentIteration: orNull(state[At.CurrentIteration]),
      endTime: player.time(At.EndTime),
      localTime: player.time(At.CurrentTime),
      progress: orNull(state[At.Progress]),
    };
  }
  updateTiming(options: object = {}) {
    if (options !== null && !$isObject(options))
      throw new TypeError("The provided value is not of type 'OptionalEffectTiming'.");
    this.$impl.refresh(false);
    const { timing, player } = this.$impl;
    const members = timing.update(options);
    if (player === null) return;
    player.doc.engine.setTiming(player.revive(), timing.numbers(), timing.exactEasing, members);
    player.changed();
  }
}

function validPseudo(pseudo: unknown): string | null {
  if (pseudo == null) return null;
  const parsed = engine.parsePseudoElement(`${pseudo}`);
  if (parsed === "") throw domError("SyntaxError", `'${pseudo}' is not a valid pseudo-element.`);
  return parsed;
}

function elementOrNull(value: unknown): N | null {
  if (value == null) return null;
  if (!(value instanceof Element) && core.nodeOf(value)?.type !== 1)
    throw new TypeError("The provided value is not of type 'Element'.");
  return core.nodeOf(value);
}

class KeyframeEffect extends AnimationEffect {
  constructor(target: any, keyframes: any = undefined, options: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    const effect = this.$impl;
    if (arguments.length === 1) {
      const source = target?.$impl;
      if (!(source instanceof Effect)) throw new TypeError("parameter 1 is not of type 'KeyframeEffect'.");
      source.refresh(true);
      effect.target = source.target;
      effect.pseudo = source.pseudo;
      effect.composite = source.composite;
      effect.frames = source.frames;
      effect.timing.update(source.timing.toObject());
      return;
    }
    effect.target = elementOrNull(target);
    effect.timing.update(options);
    if ($isObject(options)) {
      const { composite = "replace", pseudoElement } = options;
      effect.composite = oneOf(composite, composites, "CompositeOperation");
      effect.pseudo = validPseudo(pseudoElement);
    }
    effect.frames = normalizeKeyframes(keyframes);
  }
  get target() {
    return wrapOrNull(this.$impl.target);
  }
  set target(value) {
    this.$impl.target = elementOrNull(value);
    this.$impl.player?.retarget();
  }
  get pseudoElement() {
    return this.$impl.pseudo;
  }
  set pseudoElement(value) {
    this.$impl.pseudo = validPseudo(value);
    this.$impl.player?.retarget();
  }
  get composite() {
    this.$impl.refresh(false);
    return this.$impl.composite;
  }
  set composite(value) {
    const { player } = this.$impl;
    if (!composites.includes((value = `${value}`))) return;
    this.$impl.composite = value;
    if (!player?.isLive) return;
    player.doc.engine.setKeyframes(player.id, value, null, []);
    player.changed();
  }
  getKeyframes() {
    this.$impl.refresh(true);
    const { frames, player } = this.$impl;
    const inRanges =
      player?.isLive && frames.some(it => it.range !== "") && player.state()[At.Overridden] & KEYFRAMES_ARE_OVERRIDDEN;
    const computed = inRanges ? player.doc.engine.computedOffsets(player.id) : null;
    return frames.map(({ range, offset, easing, composite, values, computedOffset }, index) => {
      const frame = {
        offset: range === "" ? offset : { offset: typed().percent(offset! * 100), rangeName: range },
        easing,
        composite,
      };
      for (let i = 0; i < values.length; i += 2) frame[memberName(values[i])] = values[i + 1];
      const isUnknown = range !== "" && !player?.isCss;
      frame["computedOffset"] = orNull(computed !== null ? computed[index] : isUnknown ? NaN : computedOffset);
      return frame;
    });
  }
  setKeyframes(keyframes: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const effect = this.$impl;
    const { player } = effect;
    effect.refresh(false);
    effect.frames = normalizeKeyframes(keyframes);
    if (!player?.isLive) return;
    effect.sendKeyframes(player);
    player.changed();
  }
}

class Timeline {
  js: object;
  /** Null if it is that of a document without a window. */
  page: Page | null;
  /** In the engine. */
  id = OF_DOCUMENT;
  origin = 0;
  /** The source or the subject that a script has given. */
  node: N | null = null;

  constructor(js: object, page: Page | null) {
    this.js = js;
    this.page = page;
  }
  state(): number[] {
    return this.page!.doc.engine.timelineState(this.id);
  }
}

const clocks = new Set<Page>();

/** The time does not change within a task. */
function advanceClock(page: Page) {
  if (page.isInFrame || clocks.$has(page)) return;
  if (clocks.$add(page).size === 1) setImmediate(() => clocks.$clear());
  const now = performance.now() - page.timeOrigin;
  if (now - page.doc.engine.timelineState(0)[0] < 17) return;
  page.doc.engine.advanceClock(now);
  takeEvents(page);
}

function parseRange(edge: number, value: any): string {
  if (value === undefined) value = "normal";
  if ($isObject(value)) {
    const { offset, rangeName = "none" } = value;
    const name = oneOf(rangeName, ["none", ...rangeNames], "TimelineRange");
    if (offset !== undefined && !typed().isNumeric(offset))
      throw new TypeError("The offset must be a CSSNumericValue.");
    value = `${name === "none" ? "" : name} ${offset ?? (edge === 0 ? "0%" : "100%")}`;
  }
  const range = canonicalValue(edge === 0 ? "animation-range-start" : "animation-range-end", `${value}`);
  if (range === null || !isAbsoluteRange.test(range)) throw new TypeError(`'${value}' is not a valid range.`);
  return range;
}

type Deferred = PromiseWithResolvers<object> & { isSettled?: boolean };

class Player {
  js: Animation;
  doc: Doc;
  id: number;
  /** Whether the engine has it. If not, `last` is what it was like when it went away. */
  isLive = false;
  /** The id of the target that the engine knows. */
  nodeId = 0;
  last: number[] = [State.Idle, NaN, NaN, 1, 0, 0, NaN, NaN, 0, 0, 0, NaN, 0, 0, 0];
  effect: Effect | null = null;
  timeline: Timeline | null = null;
  range = ["normal", "normal"];
  name = "";
  trigger: Trigger | null = null;
  behaviors = "";
  isCss = false;
  hasNotified = false;
  finished: Deferred | null = null;
  ready: Deferred | null = null;

  constructor(js: Animation, doc: Doc, id: number) {
    this.js = js;
    this.doc = doc;
    this.id = id;
  }

  adopt() {
    this.isLive = true;
    this.doc.page!.animations.$set(this.id, this);
  }

  state(): number[] {
    if (!this.isLive) return this.last;
    advanceClock(this.doc.page!);
    return (this.last = sync(this.doc).animationState(this.id));
  }

  currentTimeline(): Timeline | null {
    if (!this.isCss) return this.timeline;
    const id = this.state()[At.Timeline];
    if (id !== (this.timeline?.id ?? 0)) this.timeline = timelineFor(this.doc.page!, id);
    return this.timeline;
  }

  followsScroll(): boolean {
    return (this.currentTimeline()?.id ?? OF_DOCUMENT) !== OF_DOCUMENT;
  }

  /** From the last state. */
  time(at: At) {
    const value = this.last[at];
    return value !== value ? null : this.followsScroll() ? typed().percent(value) : value;
  }

  toTime(value: unknown): number {
    if (value == null) return NaN;
    const isTyped = $isObject(value) && typed().isNumeric(value);
    if (!this.followsScroll()) return isTyped ? typed().milliseconds(value) : finite(value);
    if (!typed().isPercentage(value)) throw new TypeError("An animation that is based on progress takes a percentage.");
    return (value as any).to("percent").value;
  }

  targetId(): number {
    const target = this.effect?.target ?? null;
    if (target !== null) core.rare(target).isAnimated = true;
    return (this.nodeId = target !== null && target.scope !== null && target.doc === this.doc ? target.id : 0);
  }

  sendTimeline() {
    const { timeline } = this;
    const isActive = timeline !== null && timeline.page !== null;
    this.doc.engine.setAnimationTimeline(this.id, isActive ? timeline.id : 0, timeline?.origin ?? 0);
  }

  revive(): number {
    const { id, effect, doc, range } = this;
    advanceClock(doc.page!);
    if (this.isLive) {
      if (this.isCss) this.adopt();
      return id;
    }
    const timing = effect?.timing ?? new Timing();
    const engine = sync(doc);
    engine.createAnimation(id, this.targetId(), effect?.pseudo ?? "", timing.numbers(), timing.exactEasing);
    effect?.sendKeyframes(this);
    if (this.timeline !== doc.page!.timeline.$impl) this.sendTimeline();
    if (range[0] !== "normal") engine.setAnimationRange(id, false, range[0]);
    if (range[1] !== "normal") engine.setAnimationRange(id, true, range[1]);
    engine.restoreAnimation(id, this.last);
    this.adopt();
    return id;
  }

  retarget() {
    if (!this.isLive) return;
    sync(this.doc).setAnimationTarget(this.id, this.targetId(), this.effect?.pseudo ?? "");
    invalidate(this.doc);
  }

  setRange(edge: number, value: any) {
    const range = parseRange(edge, value);
    this.range[edge] = range;
    if (!this.isLive) return;
    sync(this.doc).setAnimationRange(this.id, edge === 1, range);
    this.changed();
  }

  getRange(edge: number) {
    const range: string =
      this.isCss && this.isLive ? sync(this.doc).animationInfo(this.id)[5 + edge] : this.range[edge];
    if (range === "normal") return range;
    const rangeName = rangeNames.find(name => range === name || range.startsWith(name + " ")) ?? "none";
    const offset = rangeName === "none" ? range : range.slice(rangeName.length + 1);
    return { offset: typed().parseNumeric(offset || (edge === 0 ? "0%" : "100%")), rangeName };
  }

  changed() {
    invalidate(this.doc);
    takeEvents(this.doc.page!);
    if (this.ready?.isSettled && this.state()[At.Pending]) this.ready = null;
  }

  control(operation: Op, value = 0) {
    if (!sync(this.doc).controlAnimation(this.revive(), operation, value)) {
      throw domError("InvalidStateError", "The animation would have to seek to an end that it does not have.");
    }
    this.changed();
  }

  notifyFinished() {
    const state = this.state();
    if (this.hasNotified || state[At.PlayState] !== State.Finished) return;
    this.hasNotified = true;
    this.settle("finished");
    const end = state[At.PlaybackRate] > 0 ? state[At.EndTime] : 0;
    this.queue("finish", state[At.StartTime] + end / state[At.PlaybackRate]);
    this.releaseIfOver();
  }

  /** `due` is a time of the timeline. */
  queue(type: string, due: number) {
    const { engineEvents } = this.doc.page!;
    const currentTime = type === "cancel" ? null : this.time(At.CurrentTime);
    const scheduled = this.followsScroll() || due !== due ? -Infinity : due + (this.timeline?.origin ?? 0);
    engineEvents.push([
      type,
      this.js.$impl,
      currentTime,
      this.time(At.TimelineTime),
      null,
      this.id,
      scheduled,
      this.isCss ? +("animationName" in this.js) : 2,
    ]);
    invalidate(this.doc);
  }

  /** It has no effect any more. `revive` makes it again if a script changes it. */
  releaseIfOver() {
    const state = this.state();
    const isFilling = state[At.ReplaceState] !== 1 && state[At.Progress] === state[At.Progress];
    const target = this.effect?.target ?? null;
    const isParked =
      isFilling &&
      this.hasNotified &&
      !this.isCss &&
      target !== null &&
      target.id === 0 &&
      !this.followsScroll() &&
      this.trigger === null;
    const isDriven = this.followsScroll() || this.trigger !== null;
    const isOver = state[At.PlayState] === State.Idle || (this.hasNotified && !isFilling && !isDriven);
    if (!this.isLive || !(isOver || isParked) || state[At.Pending] !== 0) return;
    if (isParked) parked.set(target, [...(parked.get(target) ?? []).filter(it => it !== this), this]);
    this.doc.page!.animations.$delete(this.id);
    if (this.isCss) return;
    this.doc.engine.controlAnimation(this.id, Op.Release, 0);
    this.isLive = false;
  }

  promise(key: "finished" | "ready", isDone: boolean) {
    if (this[key] === null) {
      this[key] = Promise.withResolvers();
      if (isDone) this.settle(key);
    }
    return this[key].promise;
  }

  settle(key: "finished" | "ready", isAborted = false) {
    const deferred = this[key];
    if (deferred === null) return;
    deferred.isSettled = true;
    if (!isAborted) return deferred.resolve(this.js);
    $pokePromiseAsHandled(deferred.promise);
    deferred.reject(domError("AbortError", "The user aborted a request."));
    this[key] = null;
  }
}
const isAbsoluteRange = /^(?!(?:initial|inherit|unset|revert|revert-layer|revert-rule)$)[^,]*$/;

declare global {
  namespace $Dom {
    type Player = PlayerImpl;
  }
}
type PlayerImpl = Player;

/** What fills forwards on an element that is not rendered lives as long as the element. */
const parked = new WeakMap<N, Player[]>();
let player: (animation: Animation) => Player;
let adoptedId = 0;

function timelineOrNull(value: any): Timeline | null {
  if (value == null) return null;
  if (!(value.$impl instanceof Timeline)) throw new TypeError("The provided value is not of type 'AnimationTimeline'.");
  return value.$impl;
}

class Animation extends events.EventTarget {
  #player: Player;

  static {
    player = animation => animation.#player;
  }
  constructor(effect: AnimationEffect | null = null, timeline: object | null | undefined = undefined) {
    super();
    const given = timelineOrNull(timeline);
    const { doc } = given?.page ?? (timeline === null ? effect?.$impl?.target?.doc.page : null) ?? core.realm.page;
    const it = (this.#player = new Player(this, doc, adoptedId || doc.engine.reserveAnimation()));
    adoptedId = 0;
    it.timeline = timeline === undefined ? doc.page.timeline.$impl : given;
    this.effect = effect;
  }
  get id() {
    return this.#player.name;
  }
  set id(value) {
    this.#player.name = String(value);
  }
  get effect(): any {
    return this.#player.effect?.js ?? null;
  }
  set effect(value) {
    const it = this.#player;
    const effect: Effect | null = value == null ? null : value.$impl;
    if (effect !== null && !(effect instanceof Effect))
      throw new TypeError("The provided value is not of type 'AnimationEffect'.");
    if (effect === it.effect) return;
    if (effect?.player) effect.player.js.effect = null;
    if (it.last[At.PlayState] !== State.Idle) it.revive();
    if (it.effect !== null) {
      it.effect.refresh(true);
      it.effect.player = null;
    }
    it.effect = effect;
    if (effect !== null) effect.player = it;
    if (!it.isLive) return;
    const sent = effect ?? new Effect(this);
    it.retarget();
    sent.sendKeyframes(it);
    it.doc.engine.setTiming(it.id, sent.timing.numbers(), sent.timing.exactEasing, ALL_MEMBERS);
    it.changed();
  }
  get timeline(): any {
    return this.#player.currentTimeline()?.js ?? null;
  }
  set timeline(value) {
    const it = this.#player;
    const timeline = timelineOrNull(value);
    it.revive();
    it.timeline = timeline;
    it.sendTimeline();
    it.changed();
  }
  get startTime(): any {
    this.#player.state();
    return this.#player.time(At.StartTime);
  }
  set startTime(value) {
    this.#player.control(Op.SetStartTime, this.#player.toTime(value));
  }
  get currentTime(): any {
    this.#player.state();
    return this.#player.time(At.CurrentTime);
  }
  set currentTime(value) {
    if (value != null) this.#player.control(Op.SetCurrentTime, this.#player.toTime(value));
    else if (this.currentTime !== null)
      throw new TypeError("currentTime may not be changed from resolved to unresolved");
  }
  get playbackRate() {
    return this.#player.state()[At.PlaybackRate];
  }
  set playbackRate(value) {
    this.#player.control(Op.SetPlaybackRate, finite(value));
  }
  get rangeStart() {
    return this.#player.getRange(0);
  }
  set rangeStart(value) {
    this.#player.setRange(0, value);
  }
  get rangeEnd() {
    return this.#player.getRange(1);
  }
  set rangeEnd(value) {
    this.#player.setRange(1, value);
  }
  get playState() {
    return ["idle", "running", "paused", "finished"][this.#player.state()[At.PlayState]];
  }
  get replaceState() {
    return ["active", "removed", "persisted"][this.#player.state()[At.ReplaceState]];
  }
  get pending() {
    return this.#player.state()[At.Pending] !== 0;
  }
  get overallProgress() {
    if (this.#player.effect === null) return null;
    this.#player.revive();
    const state = this.#player.state();
    if (state[At.EndTime] === 0) return state[At.CurrentTime] < 0 ? 0 : orNull(state[At.CurrentTime] * 0 + 1);
    return orNull(Math.min(Math.max(state[At.CurrentTime] / state[At.EndTime], 0), 1));
  }
  get finished() {
    if (!(#player in this)) return Promise.$reject(new TypeError("Illegal invocation"));
    this.#player.state();
    takeEvents(this.#player.doc.page!);
    return this.#player.promise("finished", this.#player.hasNotified);
  }
  get ready() {
    if (!(#player in this)) return Promise.$reject(new TypeError("Illegal invocation"));
    const it = this.#player;
    const isPending = it.state()[At.Pending] !== 0;
    takeEvents(it.doc.page!);
    if (isPending && it.ready?.isSettled) it.ready = null;
    return it.promise("ready", !isPending);
  }
  play() {
    this.#player.control(Op.Play);
  }
  pause() {
    this.#player.control(Op.Pause);
  }
  cancel() {
    this.#player.trigger?.detach(this.#player);
    if (this.#player.state()[At.PlayState] !== State.Idle) this.#player.control(Op.Cancel);
  }
  finish() {
    this.#player.control(Op.Finish);
    this.#player.notifyFinished();
  }
  reverse() {
    this.#player.control(Op.Reverse);
  }
  updatePlaybackRate(rate: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.#player.control(Op.UpdatePlaybackRate, finite(rate));
  }
  persist() {
    this.#player.control(Op.Persist);
  }
  commitStyles() {
    const it = this.#player;
    const target = it.effect?.target;
    if (!target) return;
    if (it.effect!.pseudo !== null || !("style" in core.wrap(target))) {
      throw domError("NoModificationAllowedError", "The target has no style attribute.");
    }
    if (target.scope === null || !sync(target.doc).styleBits(target.id, 1 | 64)) {
      throw domError("InvalidStateError", "Target element is not rendered.");
    }
    const values = it.doc.engine.committedStyles(it.revive());
    styleOf(target).$impl.setAll(values);
    it.releaseIfOver();
  }
}
events.defineHandlers(Animation.prototype, ["finish", "cancel", "remove"]);

class CSSAnimation extends Animation {
  constructor() {
    if (adoptedId === 0) core.illegalConstructor();
    super();
  }
  get animationName() {
    return cssNames.get(this);
  }
}
class CSSTransition extends Animation {
  constructor() {
    if (adoptedId === 0) core.illegalConstructor();
    super();
  }
  get transitionProperty() {
    return cssNames.get(this);
  }
}
const cssNames = new WeakMap<object, string>();

class AnimationTimeline {
  declare $impl: Timeline;

  constructor() {
    if (new.target === AnimationTimeline) core.illegalConstructor();
    this.$impl = new Timeline(this, core.realm.page);
  }
  get currentTime() {
    const { page, id, origin } = this.$impl;
    if (page === null || page.isDisposed) return null;
    if (id === OF_DOCUMENT) advanceClock(page);
    const time = this.$impl.state()[0];
    return id === OF_DOCUMENT ? time - origin : time === time ? typed().percent(time) : null;
  }
  get duration() {
    return this.$impl.id === OF_DOCUMENT ? null : typed().percent(100);
  }
}
class DocumentTimeline extends AnimationTimeline {
  constructor(options: { originTime?: number } = {}) {
    super();
    this.$impl.origin = finite(options?.originTime ?? 0);
  }
}

const axes = ["block", "inline", "x", "y"];
const watchers = new WeakMap<N, WeakRef<Timeline>[]>();
const collectedTimelines = new FinalizationRegistry<[any, number]>(([engine, id]) => engine.setTimelineNode(id, null));

function watch(timeline: Timeline, node: N | null, css: string) {
  const { doc } = (timeline.page = node?.doc.page ?? timeline.page)!;
  timeline.node = node;
  timeline.id = sync(doc).createTimeline(node !== null && node.scope !== null ? node.id : 0, css);
  collectedTimelines.register(timeline, [doc.engine, timeline.id]);
  if (node === null) return;
  core.rare(node).isAnimated = true;
  watchers.set(node, [...(watchers.get(node) ?? []), new WeakRef(timeline)]);
}

class ScrollTimeline extends AnimationTimeline {
  constructor(options: any = {}) {
    super();
    if (this instanceof ViewTimeline) return;
    const { axis = "block", source = core.wrap(core.realm.page.doc.node).scrollingElement } = options ?? {};
    watch(this.$impl, elementOrNull(source), `scroll(self ${oneOf(axis, axes, "ScrollAxis")})`);
  }
  get source() {
    const { node, page } = this.$impl;
    if (node !== null && !(this instanceof ViewTimeline)) return core.wrap(node);
    sync(page!.doc).updateLayout();
    const id = this.$impl.state()[1];
    if (id === 1) return core.wrap(page!.doc.node).scrollingElement;
    const source = page!.doc.nodes[id];
    return source ? core.wrap(core.outOfControl(source)) : null;
  }
  get axis() {
    return axes[this.$impl.state()[3]];
  }
}
class ViewTimeline extends ScrollTimeline {
  constructor(options: any = {}) {
    super();
    const { axis = "block", inset = "auto", subject } = options ?? {};
    const isList = $isObject(inset) && inset[Symbol.iterator] != null;
    const insets = canonicalValue("view-timeline-inset", isList ? Array.from(inset).join(" ") : `${inset}`);
    if (insets === null || !isAbsoluteRange.test(insets)) throw new TypeError("Invalid inset");
    watch(this.$impl, elementOrNull(subject), `view(${oneOf(axis, axes, "ScrollAxis")} ${insets})`);
  }
  get subject() {
    return wrapOrNull(this.$impl.node ?? this.$impl.page!.doc.nodes[this.$impl.state()[2]] ?? null);
  }
  get startOffset() {
    return typed().px(this.$impl.state()[5] || 0);
  }
  get endOffset() {
    return typed().px(this.$impl.state()[6] || 0);
  }
}

const behaviors = ["play", "pause", "reset", "play-once", "play-forwards", "play-backwards", "replay", "none"];
const edges = ["activationRangeStart", "activationRangeEnd", "activeRangeStart", "activeRangeEnd"];

class Trigger {
  timeline: Timeline | null = null;
  edges: string[] = [];
  players: Player[] = [];
  ranges: any = null;

  detach(it: Player) {
    this.players.splice(this.players.indexOf(it), 1);
    it.behaviors = "";
    this.send(it);
    it.trigger = null;
  }

  send(it: Player) {
    it.doc.engine.setAnimationTrigger(it.id, this.timeline?.id ?? 0, this.edges.join(), it.behaviors);
  }
}

function playerOf(animation: unknown): Player {
  if (!(animation instanceof Animation)) throw new TypeError("parameter 1 is not of type 'Animation'.");
  return player(animation);
}

class AnimationTrigger {
  declare $impl: Trigger;

  constructor() {
    if (new.target === AnimationTrigger) core.illegalConstructor();
    this.$impl = new Trigger();
  }
  addAnimation(animation: unknown, activateBehavior: string, deactivateBehavior = "none") {
    if ($argumentCount() < 2) core.tooFew(2);
    const it = playerOf(animation);
    const both = [activateBehavior, deactivateBehavior]
      .map(value => oneOf(value, behaviors, "AnimationTriggerBehavior"))
      .join(" ");
    if (it.trigger !== null && it.trigger !== this.$impl) {
      throw domError("NotSupportedError", "Attaching multiple triggers to an animation is not allowed.");
    }
    if (it.trigger === null) this.$impl.players.push(it);
    it.trigger = this.$impl;
    it.behaviors = both;
    it.revive();
    this.$impl.send(it);
    it.changed();
  }
  removeAnimation(animation: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = playerOf(animation);
    if (it.trigger !== this.$impl) return;
    this.$impl.detach(it);
    it.releaseIfOver();
  }
  getAnimations() {
    return this.$impl.players.map(it => it.js);
  }
}

class TimelineTriggerRange {
  declare $impl: Trigger;

  constructor() {
    core.illegalConstructor();
  }
  get timeline() {
    return this.$impl.timeline?.js ?? null;
  }
}
edges.forEach((name, index) =>
  core.accessor(TimelineTriggerRange.prototype, name, function (this: TimelineTriggerRange) {
    return this.$impl.edges[index];
  }),
);

class TimelineTriggerRangeList {
  constructor() {
    core.illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(TimelineTriggerRangeList, true);

class TimelineTrigger extends AnimationTrigger {
  constructor(options: any = []) {
    super();
    const all: any[] = Array.from(options);
    if (all.length > 1) throw new TypeError("Multiple timelines are not supported.");
    const it = this.$impl;
    const ranges = all.map(given => {
      it.timeline = given?.timeline === undefined ? core.realm.page.timeline.$impl : timelineOrNull(given.timeline);
      it.edges = edges.map((name, index) => {
        const value = given?.[name] ?? given?.[edges[index ^ 2]] ?? (index < 2 ? "normal" : "auto");
        return value !== "auto" ? parseRange(index & 1, value) : index < 2 ? "normal" : value;
      });
      const range = Object.create(TimelineTriggerRange.prototype);
      $putByIdDirectPrivate(range, "impl", it);
      return range;
    });
    it.ranges = makeList(TimelineTriggerRangeList, { size: () => ranges.length, at: index => ranges[index] });
  }
  get ranges() {
    return this.$impl.ranges;
  }
}
for (const ctor of [AnimationTrigger, TimelineTrigger, TimelineTriggerRange, TimelineTriggerRangeList]) expose(ctor);
for (const ctor of [AnimationEffect, KeyframeEffect, Animation, CSSAnimation, CSSTransition]) expose(ctor);
for (const ctor of [AnimationTimeline, DocumentTimeline, ScrollTimeline, ViewTimeline]) expose(ctor);

function createTimeline(page: Page | null) {
  const timeline = Object.create(DocumentTimeline.prototype);
  $putByIdDirectPrivate(timeline, "impl", new Timeline(timeline, page));
  return timeline;
}

const cssTimelines = new WeakMap<Doc, Map<number, Timeline>>();

function timelineFor(page: Page, id: number): Timeline | null {
  if (id === 0 || id === OF_DOCUMENT) return id === 0 ? null : (page.timeline as AnimationTimeline).$impl;
  let known = cssTimelines.get(page.doc);
  if (known === undefined) cssTimelines.set(page.doc, (known = new Map()));
  let timeline = known.$get(id);
  if (timeline === undefined) {
    const js = Object.create((page.doc.engine.timelineState(id)[4] ? ViewTimeline : ScrollTimeline).prototype);
    $putByIdDirectPrivate(js, "impl", (timeline = new Timeline(js, page)));
    timeline.id = id;
    known.$set(id, timeline);
  }
  return timeline;
}

/** Those that styles have started, which stay in the engine for as long as scripts have them. */
const cssPlayers = new WeakMap<Doc, Map<number, WeakRef<Player>>>();
const collectedPlayers = new FinalizationRegistry<[Doc, number]>(([doc, id]) => {
  cssPlayers.get(doc)!.$delete(id);
  doc.engine.controlAnimation(id, Op.Release, 0);
});

function playerFor(doc: Doc, id: number): Player | undefined {
  return doc.page!.animations.$get(id) ?? cssPlayers.get(doc)?.$get(id)?.deref();
}

function animationFor(doc: Doc, id: number, target: N | null = null, pseudo = ""): Animation | null {
  const known = playerFor(doc, id);
  if (known !== undefined) return known.js;
  const [kind, name, node, pseudoOfNode, easing] = doc.engine.animationInfo(id);
  target ??= doc.nodes[+node];
  pseudo ||= pseudoOfNode;
  if (kind === undefined) return null;
  const options = { easing, pseudoElement: pseudo || null };
  adoptedId = id;
  const animation = new (kind === "transition" ? CSSTransition : CSSAnimation)();
  const it = player(animation);
  animation.effect = new KeyframeEffect(wrapOrNull(target ?? null), null, options);
  cssNames.set(animation, name);
  it.doc = doc;
  it.nodeId = +node;
  it.isCss = true;
  it.adopt();
  if (node === "0") it.retarget();
  if (!cssPlayers.has(doc)) cssPlayers.set(doc, new Map());
  cssPlayers.get(doc)!.$set(id, new WeakRef(it));
  collectedPlayers.register(it, [doc, id]);
  it.hasNotified = it.state()[At.PlayState] === State.Finished;
  it.releaseIfOver();
  return animation;
}

function getAnimations(node: N, subtree: boolean) {
  const { doc } = node;
  if (node.scope === null || doc.page === null) return [];
  const ids = sync(doc).getAnimations(node.id, subtree);
  invalidate(doc);
  return ids.map(id => animationFor(doc, id));
}

core.mixin(
  {
    animate(this: any, keyframes: any, options: any = undefined) {
      if ($argumentCount() < 1) core.tooFew(1);
      const effect = new KeyframeEffect(this, keyframes, options);
      const {
        id,
        rangeEnd,
        rangeStart,
        timeline = core.wrap(this.$impl.doc.node).timeline,
      } = $isObject(options) ? options : ({} as any);
      const animation = new Animation(effect, timeline);
      if (id !== undefined) animation.id = id;
      if (rangeStart !== undefined) animation.rangeStart = rangeStart;
      if (rangeEnd !== undefined) animation.rangeEnd = rangeEnd;
      animation.play();
      return animation;
    },
    getAnimations(this: any, options: any = undefined) {
      return getAnimations(this.$impl, !!options?.subtree);
    },
  },
  Element,
);

/**
 * Settles the promises of what has happened in the engine, and queues the events for the next frame, with the nodes in
 * place of their ids, which the engine uses again.
 */
const playbackTypes = new Set(["finish", "cancel", "remove", "ready", "unfinish"]);

function takeEvents(page: Page) {
  const { doc, engineEvents } = page;
  if (!(doc.engine.pending() & 2)) return;
  for (const event of JSON.parse(doc.engine.takeEvents())) {
    const type: string = event[0];
    if (type === "scrolled") {
      page.scrollRequests.$get(event[2])?.({ interrupted: event[3] });
      page.scrollRequests.$delete(event[2]);
      continue;
    }
    if (!playbackTypes.$has(type)) {
      if (!events.isListenedTo(type)) continue;
      event[1] = doc.nodes[event[1]];
      if (type.startsWith("scrollsnap"))
        [event[2], event[3]] = [event[2] ? doc.nodes[event[2]] : null, event[3] ? doc.nodes[event[3]] : null];
      if (event[1]) engineEvents.push(event);
      continue;
    }
    const it = playerFor(doc, event[2]);
    if (it === undefined) continue;
    if (type === "ready") {
      it.settle("ready");
      if (it.hasNotified) it.releaseIfOver();
    } else if (type === "finish") queueMicrotask(() => it.notifyFinished());
    else if (type === "unfinish") {
      it.adopt();
      if (it.hasNotified) it.finished = null;
      it.hasNotified = false;
    } else {
      if (type === "cancel") {
        if (event[3]) it.settle("ready", true);
        it.settle("finished", true);
        it.hasNotified = false;
      }
      it.queue(type, it.state()[At.TimelineTime]);
      it.releaseIfOver();
    }
  }
  if (engineEvents.length > 0) invalidate(doc);
}

const dueAt = (event: any[]) => Math.round((event[6] ?? -Infinity) * 1000);

function dispatchEvents(page: Page) {
  if (page.doc.engine.pending() & 2) {
    takeEvents(page);
    if (page.animations.size > 0) drainMicrotasks();
  }
  if (page.engineEvents.length === 0) return;
  const queued = page.engineEvents.splice(0);
  if (queued.length > 1) queued.sort((a, b) => dueAt(a) - dueAt(b) || (a[7] ?? 3) - (b[7] ?? 3));
  for (const [type, target, first, second, pseudo, animation] of queued) {
    if (type === "scroll" || type === "scrollend") {
      events.fire(
        target.rare?.pseudo === "-internal-editor" ? core.outOfControl(target) : target,
        type,
        target === page.doc.node,
      );
    } else if (type.startsWith("scrollsnap")) {
      const init = {
        bubbles: target === page.doc.node,
        snapTargetBlock: core.wrapOrNull(first),
        snapTargetInline: core.wrapOrNull(second),
      };
      events.dispatch(target, new events.SnapEvent(type, init));
    } else if (type.startsWith("transition")) {
      const init = { bubbles: true, cancelable: type === "transitionend", propertyName: first, elapsedTime: second };
      events.dispatch(target, new events.TransitionEvent(type, { ...init, pseudoElement: pseudo }, target, animation));
    } else if (type.startsWith("animation")) {
      const init = { bubbles: true, animationName: first, elapsedTime: second, pseudoElement: pseudo };
      events.dispatch(target, new events.AnimationEvent(type, init, target, animation));
    } else if (type.startsWith("content")) {
      events.dispatch(
        target,
        new events.ContentVisibilityAutoStateChangeEvent(type, { bubbles: true, skipped: first }),
      );
    } else if (type.endsWith("Event")) events.fire(target, type);
    else events.dispatch(target, new events.AnimationPlaybackEvent(type, { currentTime: first, timelineTime: second }));
  }
}

core.hooks.animatedForgotten = (node: N) =>
  queueMicrotask(() => {
    if (node.id !== 0) return;
    for (const it of node.doc.page?.animations.values() ?? []) if (it.effect?.target === node) it.releaseIfOver();
  });

core.hooks.animatedMirrored = node => {
  for (const it of parked.get(node) ?? []) {
    if (!it.isLive && it.effect?.target === node && it.doc.page !== null && it.last[At.PlayState] !== State.Idle)
      it.revive();
  }
  parked.delete(node);
  for (const it of node.doc.page?.animations.values() ?? []) {
    if (it.effect?.target === node && it.nodeId !== node.id) it.retarget();
  }
  for (const it of watchers.get(node) ?? []) {
    const timeline = it.deref();
    if (timeline?.page === node.doc.page) node.doc.engine.setTimelineNode(timeline.id, node.id);
  }
};

core.hooks.animationFor = (target, id, pseudo) => target.doc.page && animationFor(target.doc, id, target, pseudo);
core.hooks.takeEngineEvents = takeEvents;

export default { createTimeline, dispatchEvents, getAnimations, takeEvents };
