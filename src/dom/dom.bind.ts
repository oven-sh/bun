import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bindings" });

const id = b.u32;
const text = b.string.utf8;
const numbers = b.array(b.f64);
/** A `Float64Array`. */
const doubles = b.bytes({ from: ["buffer"] });
const bytes = b.bytes({ from: ["buffer"] });
const ids = b.array(b.u32);
const strings = b.array(b.string.utf8);
/** In a text node, a UTF-16 offset. In any other node, the id of the child after the point, or 0 for the end. */
const point = { node: id, offset: b.u32 };
const range = { startNode: id, startOffset: b.u32, endNode: id, endOffset: b.u32 };

/**
 * The styles, the layout and the display list of a document, which is node 1. Node 0 is no node. Lengths are CSS
 * pixels relative to the viewport. What reads a style or a position brings it up to date first.
 */
export const DesktopEngine = b.class({
  rustPath: "crate::bindings::Engine",
  construct: { args: { fontScope: b.u32, baseUrl: text } },
  mutator: "guarded",
  proto: {
    /** It has kept panicking, and does nothing any more. */
    isBroken: { returns: b.bool },
    panicForTesting: { mutates: true },
    /** `namespace`: 0 HTML, 1 SVG, 2 MathML, 3 any other. */
    createElement: { args: { localName: text, namespace: b.u8 }, returns: id, mutates: true },
    createText: { args: { data: text }, returns: id, mutates: true },
    /** A root for a tree that is not in the document, to match selectors in it. */
    createFragment: { returns: id, mutates: true },
    createDocument: { returns: id, mutates: true },
    attachShadow: { args: { host: id, userAgent: b.bool }, returns: id, mutates: true },
    /** `child` is new, or else it moves within its document or shadow tree. */
    insert: { args: { parent: id, child: id, before: id }, mutates: true },
    moveNode: { args: { parent: id, child: id, before: id }, mutates: true },
    /** Frees the ids of the node, of its descendants and of their shadow trees. */
    remove: { args: { node: id }, mutates: true },
    setText: { args: { node: id, data: text }, mutates: true },
    /** `style` too. */
    setAttribute: { args: { node: id, name: text, value: text }, mutates: true },
    removeAttribute: { args: { node: id, name: text }, mutates: true },
    /** Bits of `State` in `tree.rs`. */
    setState: { args: { node: id, bits: b.u32, on: b.bool }, mutates: true },
    setCustomState: { args: { node: id, name: text, on: b.bool }, mutates: true },
    /** The element, in the shadow tree of a control, is `originator::name`. */
    setPseudo: { args: { node: id, name: text, originator: id }, mutates: true },
    assignSlot: { args: { slot: id, nodes: ids }, mutates: true },
    /** `image` is an id of the library, or 0. NaN is no natural width, height or ratio. */
    setReplaced: { args: { node: id, image: b.u32, width: b.f64, height: b.f64, ratio: b.f64 }, mutates: true },
    clearReplaced: { args: { node: id }, mutates: true },
    /** An element that is no longer in the list stays in the top layer for as long as `overlay` transitions. */
    setTopLayer: { args: { nodes: ids }, mutates: true },
    /** What `position-anchor: auto` stands for. */
    setImplicitAnchor: { args: { node: id, anchor: id }, mutates: true },
    /** Of the elements that have no `lang` attribute above them. */
    setLanguage: { args: { language: text }, mutates: true },
    /** What `color-scheme: normal` stands for. False if that is not a value of the property. */
    setColorScheme: { args: { source: text }, returns: b.bool, mutates: true },
    setBaseUrl: { args: { url: text }, mutates: true },

    /** `owner` is the root of an `@scope` rule that names none. */
    createSheet: {
      args: { source: text, baseUrl: text, media: text, owner: b.u32.default(0) },
      returns: b.u32,
      mutates: true,
    },
    createSheetFromUtf8: {
      args: { source: doubles, baseUrl: text, media: text, owner: b.u32.default(0) },
      returns: b.u32,
      mutates: true,
    },
    /** Another thread starts on what `createSheetFromUtf8` is expected to be called with. */
    prepareSheet: { args: { source: bytes }, mutates: true },
    sheetSource: { args: { sheet: b.u32 }, returns: text },
    releaseSheet: { args: { sheet: b.u32 }, mutates: true },
    /** For each `@import` its URL, and the text to put before the imported sheet. One `}` for each `{` goes after. */
    sheetImports: { args: { sheet: b.u32 }, returns: strings, mutates: true },
    /** Of the document or of a shadow root, in order. An imported sheet comes before the one that imports it. */
    setSheets: { args: { scope: id, sheets: ids }, mutates: true },
    registerProperty: {
      args: { name: text, syntax: text, inherits: b.bool, initial: text.nullable },
      returns: b.bool,
      mutates: true,
    },
    matchMedia: { args: { query: text }, returns: b.bool, mutates: true },
    sourceSize: { args: { sizes: text }, returns: b.f64, mutates: true },

    /** -1 if the selector is invalid, as for `closest` and `querySelector`. Else 0 or 1. */
    matches: { args: { node: id, selector: text }, returns: b.i32, mutates: true },
    closest: { args: { node: id, selector: text }, returns: b.i32, mutates: true },
    querySelector: { args: { root: id, selector: text }, returns: b.i32, mutates: true },
    querySelectorAll: { args: { root: id, selector: text }, returns: ids.nullable, mutates: true },

    /**
     * `values`: the viewport's width and height, `devicePixelRatio`, the page zoom, the screen's width and height, the
     * accent color, and the x, y, width and height of `titlebar-area-*` (NaN if there is none).
     * `flags`: 1 dark, 2 reduced motion, 4 more contrast, 8 fullscreen, 16 overlay scrollbars, 32 the window is active.
     */
    setEnvironment: { args: { values: numbers, flags: b.u32 }, mutates: true },
    fontsChanged: { mutates: true },
    /** Requests what `@font-face` has for it, as if an element used it. */
    useFont: { args: { family: text, weight: b.u32, isItalic: b.bool }, mutates: true },
    /** Answers a request. `image` is 0 if it did not load. */
    setImage: { args: { url: text, image: b.u32, width: b.f64, height: b.f64, ratio: b.f64 }, mutates: true },
    /** Answers a request for an SVG file that has something like a filter. `source` is empty if it did not load. */
    setExternal: { args: { url: text, source: bytes }, mutates: true },
    /** An SVG image, which every engine of the thread can show: its id or 0, its width, its height and its ratio. */
    createVector: { args: { source: bytes, url: text, fontScope: b.u32 }, returns: numbers },
    /** An image of the library that shows it at this size. */
    recordVector: { args: { image: b.u32, width: b.f64, height: b.f64 }, returns: b.u32 },
    releaseVector: { args: { image: b.u32 } },
    takeVectorRequests: { args: { image: b.u32 }, returns: strings },
    setVectorImage: { args: { vector: b.u32, url: text, image: b.u32, width: b.f64, height: b.f64, ratio: b.f64 } },
    vectorFontsChanged: { args: { image: b.u32 } },
    /** Applies the fragment of the base URL to the root `svg`. */
    showFragment: { mutates: true },
    /** Captures the old state, captures the new state, follows it, or ends. 0 if it fails, and 2 while it is animated. */
    viewTransition: { args: { step: b.u8, canvas: b.u32 }, returns: b.u8, mutates: true },
    /** Pairs: "image" or "svg" and a URL, "font" and the JSON of an `@font-face`, or "unfont" and that of a removed one. */
    takeRequests: { returns: strings, mutates: true },

    /** `document.timeline.currentTime`. Advances the animations and the smooth scrolls. */
    setTime: { args: { now: b.f64 }, mutates: true },
    updateStyle: { mutates: true },
    /** A number that changes when a box moved, scrolled, or changed its size. */
    updateLayout: { returns: b.u32, mutates: true },
    sizesVersion: { returns: b.u32 },
    isAnimating: { returns: b.bool, mutates: true },
    /** 2: there are events. 4: there are requests. 8: another frame is needed. */
    pending: { returns: b.u32, mutates: true },
    paint: { args: { surface: b.u32 }, mutates: true },
    /**
     * In how many milliseconds a frame is needed for what does not need every one, or Infinity. `forIterations`:
     * something listens to `animationiteration`.
     */
    nextWake: { args: { forIterations: b.bool }, returns: b.f64, mutates: true },
    /** Whether the library scrolls and animates what it can. */
    setComposited: { args: { on: b.bool }, mutates: true },
    /** The arguments of the `scroll` hook of the library. */
    scrolledByCompositor: {
      args: { scroller: b.u32, x: b.f64, y: b.f64, hasEnded: b.bool, generation: b.u32 },
      mutates: true,
    },
    /** Whether the node has a `wheel` listener that is not passive. The document stands for the window too. */
    setBlocksWheel: { args: { node: id, on: b.bool }, mutates: true },
    /** What `paint` would draw, a line for each item. */
    dumpDisplayList: { returns: text, mutates: true },
    /**
     * A JSON array of `[type, node, ...]`. "scroll" and "scrollend" have nothing more.
     * "contentvisibilityautostatechange" has `skipped`. "transition*" and "animation*" have the name, the elapsed
     * seconds, the pseudo-element, the animation's id and the time that it was due. "finish", "unfinish", "cancel",
     * "remove" and "ready" have the animation's id, and "cancel" whether it was pending.
     */
    takeEvents: { returns: text, mutates: true },

    /** What `typedValue` in cssom.ts returns. */
    computedValue: { args: { node: id, property: text }, returns: strings, mutates: true },
    customPropertyNames: { args: { node: id, pseudo: text }, returns: strings, mutates: true },
    computedStyle: { args: { node: id, pseudo: text, property: text }, returns: text, mutates: true },
    /**
     * 1 has a box (or is text that is laid out), 2 `visibility: visible`, 4 editable, 8 plain text only, 16 inert,
     * 32 the user can scroll it, 64 `display: contents`, 128 `opacity: 0` on it or above it, 256 skipped by
     * `content-visibility: auto`, 512 `user-select: none`, 1024 `user-select: all`, 2048 block-level, 4096 right to
     * left, 8192 preserves spaces, 16384 skipped by `content-visibility: hidden`, 32768 preserves line breaks,
     * 65536 has a `reading-flow`, 131072 has a dark color scheme, 262144 `color-scheme` is not `normal`.
     */
    styleBits: { args: { node: id, wanted: b.u32 }, returns: b.u32, mutates: true },

    /** x, y, width, height */
    boundingRect: { args: { node: id }, returns: numbers, mutates: true },
    clientRects: { args: { node: id }, returns: numbers, mutates: true },
    rangeRects: { args: range, returns: numbers, mutates: true },
    /** offsetParent, offsetLeft, offsetTop, offsetWidth, offsetHeight */
    offsetMetrics: { args: { node: id }, returns: numbers, mutates: true },
    /** clientLeft, clientTop, clientWidth, clientHeight. The document is the viewport, here and below. */
    clientMetrics: { args: { node: id }, returns: numbers, mutates: true },
    /** scrollLeft, scrollTop, scrollWidth, scrollHeight */
    scrollMetrics: { args: { node: id }, returns: numbers, mutates: true },
    /** One of `clientMetrics` from 0, of `scrollMetrics` from 4, and of `offsetMetrics` from 8. */
    metric: { args: { node: id, which: b.u8 }, returns: b.f64, mutates: true },
    /** The x of `boundingRect`. `measured` has all four until the next call. */
    measure: { args: { node: id }, returns: b.f64, mutates: true },
    measured: { args: { index: b.u8 }, returns: b.f64 },
    /** Without a layout. */
    lastViewportScroll: { args: { axis: b.u8 }, returns: b.f64 },
    /** For `ResizeObserver`: the content box's x, y, width and height, and the border box's width and height. */
    boxSizes: { args: { node: id }, returns: numbers, mutates: true },
    /**
     * `records`: a node, 0 for its content box, 1 for its border box or 2 for its content box in device pixels, and a
     * width and a height. Returns the indexes of those that have another size.
     */
    changedSizes: { args: { records: doubles, scale: b.f64 }, returns: ids.nullable },
    /**
     * `records`: a node, a root, how many thresholds are crossed, where in `settings` the margins are, as for
     * `intersection`, and how many thresholds follow them. Returns the indexes of those that cross another number.
     */
    changedIntersections: { args: { records: doubles, settings: doubles }, returns: ids.nullable },
    /**
     * `margins`: top, right, bottom and left of `rootMargin` and then of `scrollMargin`, each a length and a
     * percentage. Returns `isIntersecting`, and the rects of the target, of the intersection and of the root.
     */
    intersection: { args: { node: id, root: id, margins: numbers }, returns: numbers, mutates: true },
    /** What paint timing counts, in groups of 8. See contentful.rs. */
    contentful: { args: { only: id }, returns: numbers, mutates: true },

    /** `getBBox()` */
    /** `kind`: 0 of the fill, 1 with the stroke, 2 at least of all that is painted. */
    svgBox: { args: { node: id, kind: b.u8 }, returns: numbers, mutates: true },
    /** From the user space of the element to the viewport, or to the box of the outermost `svg`. Six numbers. */
    svgMatrix: { args: { node: id, toViewport: b.bool }, returns: numbers, mutates: true },
    /** The total length, and the x and y of the point at `distance`. */
    svgPointAtLength: { args: { node: id, distance: b.f64 }, returns: numbers, mutates: true },
    /** For each UTF-16 code unit: the start, the end, the extent, the rotation and the advance. Ten numbers. */
    svgCharacters: { args: { node: id }, returns: numbers, mutates: true },
    svgContains: { args: { node: id, x: b.f64, y: b.f64, inStroke: b.bool }, returns: b.bool, mutates: true },
    /** In user units, or NaN. `axis` is 2 for neither. */
    svgLength: { args: { node: id, value: text, axis: b.u8 }, returns: b.f64, mutates: true },
    setSvgZoom: { args: { scale: b.f64, x: b.f64, y: b.f64 }, mutates: true },
    /**
     * 0 starts the timelines. For an `svg`: 1 gives the time and whether it is paused, 2 seeks, 3 pauses or resumes. For
     * an animation: 4 begins and 5 ends it after `value` seconds, 6 and 7 do so for an event, and 8 gives the start, the
     * current time and the simple duration. 9 sets the clock, in milliseconds.
     */
    controlSmil: { args: { node: id, operation: b.u8, value: b.f64 }, returns: numbers, mutates: true },
    animatedAttribute: { args: { node: id, name: text }, returns: text.nullable, mutates: true },

    /** NaN leaves an axis alone. `behavior`: 0 auto, 1 instant, 2 smooth, plus 4 if it is by a distance. */
    scrollTo: { args: { node: id, x: b.f64, y: b.f64, behavior: b.u8 }, mutates: true },
    /** `block` and `inline`: 0 start, 1 center, 2 end, 3 nearest, 4 center unless it is visible. */
    scrollIntoView: {
      args: { node: id, block: b.u8, inline: b.u8, behavior: b.u8, onlyNearest: b.bool },
      mutates: true,
    },
    revealPoint: { args: { ...point, upstream: b.bool }, mutates: true },
    /**
     * Scrolls the nearest box around `node` that can move that way, and returns it. `unit`: 0 pixels, 1 lines,
     * 2 pages, 3 to the end.
     */
    userScroll: {
      args: { node: id, dx: b.f64, dy: b.f64, unit: b.u8, smooth: b.bool },
      returns: id,
      mutates: true,
    },
    /** Scrollbars and resizers. `kind`: 0 move, 1 down, 2 up, 3 leave. Returns the element whose part took it. */
    scrollbarMouse: { args: { kind: b.u8, x: b.f64, y: b.f64 }, returns: id, mutates: true },
    /**
     * Scroll markers and buttons. `action`: 0 activate `part`, 1 activate what has the focus, 2 and 3 go to the previous and the
     * next marker, 4 blur. Returns the element that counts as focused or, plus 2 ** 30, the one to go on from.
     */
    controlScrolling: { args: { action: b.u8, part: id }, returns: id, mutates: true },

    /** An element or a text node, maybe in a shadow tree. */
    hitTest: { args: { x: b.f64, y: b.f64 }, returns: id, mutates: true },
    hitTestAll: { args: { x: b.f64, y: b.f64 }, returns: ids, mutates: true },
    cursorAt: { args: { x: b.f64, y: b.f64 }, returns: text, mutates: true },
    /** The point in the border box of `node`, for `offsetX` and `offsetY`. */
    toLocal: { args: { node: id, x: b.f64, y: b.f64 }, returns: numbers, mutates: true },

    /** The nearest place for a caret in `root`: node, offset, and 1 if it is at the end of a line that wraps. */
    pointAt: { args: { root: id, x: b.f64, y: b.f64 }, returns: ids, mutates: true },
    caretRect: { args: { ...point, upstream: b.bool }, returns: numbers, mutates: true },
    /**
     * `direction`: 0 forward, 1 backward, 2 left, 3 right. `granularity`: 0 character, 1 word, 2 line, 3 lineboundary,
     * 4 paragraph, 5 paragraphboundary, 6 documentboundary, 7 page, 8 only to the nearest place for a caret.
     * `x` is where vertical movement aims at, or NaN. Returns what `pointAt` does.
     */
    movePoint: {
      args: { root: id, ...point, upstream: b.bool, direction: b.u8, granularity: b.u8, x: b.f64 },
      returns: ids,
      mutates: true,
    },
    /** The word (0) or the paragraph (1) around the point, as the four numbers of a range. */
    expandPoint: { args: { root: id, ...point, granularity: b.u8 }, returns: ids, mutates: true },
    /** What to paint. `caret`: 0 none, 1 downstream, 2 upstream. A `startNode` of 0 is no selection. */
    setSelection: { args: { ...range, caret: b.u8 }, mutates: true },
    /** `::highlight(name)`, or the text that is being composed if `name` is "". Four numbers for each range. */
    setHighlight: { args: { name: text, priority: b.i32, ranges: ids }, mutates: true },
    /** 1 if the `select` has `appearance: base-select`, 2 if its picker or list box has. */
    isSetByAuthor: { args: { node: b.u32, property: text }, returns: b.bool, mutates: true },
    baseAppearance: { args: { node: b.u32 }, returns: b.u32, mutates: true },
    innerText: { args: { node: b.u32 }, returns: text, mutates: true },
    /** `Selection.toString()` */
    renderedText: { args: { ...range, onlySelectable: b.bool }, returns: text, mutates: true },

    /** An id for `createAnimation`. The earlier ones are below the later ones. */
    reserveAnimation: { returns: b.u32, mutates: true },
    /**
     * `timing`: delay, endDelay, duration (negative for "auto"), iterations, iterationStart, fill (0 none, 1 forwards,
     * 2 backwards, 3 both) and direction (0 normal, 1 reverse, 2 alternate, 3 alternate-reverse). The animation is idle.
     * `node` may be 0.
     */
    createAnimation: {
      args: { animation: b.u32, node: id, pseudo: text, timing: numbers, easing: text },
      mutates: true,
    },
    setAnimationTarget: { args: { animation: b.u32, node: id, pseudo: text }, mutates: true },
    /** `frames`: for each keyframe the name of its range, its easing, its composite operation, and its declarations. */
    setKeyframes: {
      args: { animation: b.u32, composite: text, offsets: numbers.nullable, frames: b.array(text.owned) },
      mutates: true,
    },
    /** `members` has a bit for each number that changes, and one for the easing. */
    setTiming: { args: { animation: b.u32, timing: numbers, easing: text, members: b.u32 }, mutates: true },
    setAnimationTrigger: { args: { animation: b.u32, timeline: b.u32, ranges: text, behaviors: text }, mutates: true },
    setAnimationRange: { args: { animation: b.u32, isEnd: b.bool, range: text }, mutates: true },
    /** `timeline` is 0 for none, and 0xffffffff for one that is 0 when that of the document is `origin`. */
    setAnimationTimeline: { args: { animation: b.u32, timeline: b.u32, origin: b.f64 }, mutates: true },
    /**
     * 0 play, 1 pause, 2 cancel, 3 finish, 4 reverse, 5 set currentTime, 6 set startTime, 7 set playbackRate,
     * 8 updatePlaybackRate, 9 persist, 10 JavaScript has let go of it. False if the state does not allow it.
     */
    controlAnimation: { args: { animation: b.u32, operation: b.u8, value: b.f64 }, returns: b.bool, mutates: true },
    restoreAnimation: { args: { animation: b.u32, state: numbers }, mutates: true },
    /** `At` in animation.ts. NaN is null. */
    animationState: { args: { animation: b.u32 }, returns: numbers, mutates: true },
    /** "animation" or "transition", the name, the node, the pseudo-element, the easing, and the start and end of the range. */
    animationInfo: { args: { animation: b.u32 }, returns: strings, mutates: true },
    computedOffsets: { args: { animation: b.u32 }, returns: numbers, mutates: true },
    /** These are described in animation.rs. */
    computedKeyframes: { args: { animation: b.u32 }, returns: strings, mutates: true },
    committedStyles: { args: { animation: b.u32 }, returns: strings, mutates: true },
    /** `source` is `scroll()` or `view()`. */
    createTimeline: { args: { node: id, source: text }, returns: b.u32, mutates: true },
    /** null if JavaScript has let go of it. */
    setTimelineNode: { args: { timeline: b.u32, node: b.u32.nullable }, mutates: true },
    /**
     * The time, the source, the node that it was made for, the axis (0 block, 1 inline, 2 x, 3 y), whether it is a view
     * timeline, startOffset and endOffset. For 0, the time of the document.
     */
    timelineState: { args: { timeline: b.u32 }, returns: numbers, mutates: true },
    /** `setTime` between frames. */
    advanceClock: { args: { now: b.f64 }, mutates: true },
    getAnimations: { args: { node: id, subtree: b.bool }, returns: ids, mutates: true },
  },
});

export const supportsDeclaration = b.fn({ args: { name: text, value: text }, returns: b.bool });
export const supportsCondition = b.fn({ args: { condition: text }, returns: b.bool });
/** The name, the value, and "important" or "". */
export const parseDeclarations = b.fn({ args: { source: text }, returns: strings });
export const propertyNames = b.fn({ args: {}, returns: strings });
/** Those of a shorthand, or the property itself under the name that it is an alias of. */
export const longhands = b.fn({ args: { name: text }, returns: strings });
export const shorthandsOf = b.fn({ args: { name: text }, returns: strings });
/** These are described in cssom.rs. */
export const expandDeclaration = b.fn({
  args: { rule: text, name: text, value: text, important: b.bool },
  returns: strings,
});
export const splitRules = b.fn({ args: { source: text, hasDeclarations: b.bool, isNested: b.bool }, returns: strings });
export const parsePrelude = b.fn({
  args: { source: text, parent: text, body: text.nullable, namespaces: text },
  returns: strings,
});
/** From the values of its longhands, with NUL between them. "" if it cannot stand for them. */
export const joinShorthand = b.fn({ args: { name: text, values: text }, returns: text });
/** These return "", or else nothing, for what is invalid. */
export const parseEasing = b.fn({ args: { source: text }, returns: text });
export const parseKeyframeOffset = b.fn({ args: { source: text }, returns: strings });
export const parsePseudoElement = b.fn({ args: { source: text }, returns: text });
export const simplifyMath = b.fn({ args: { source: text }, returns: text });
export const isAnimatable = b.fn({ args: { name: text }, returns: b.bool });
export const splitValue = b.fn({ args: { source: text, atCommas: b.bool }, returns: strings });
export const splitVariables = b.fn({ args: { source: text }, returns: strings });
/** The serialization of each query. */
export const parseMedia = b.fn({ args: { source: text }, returns: strings });
/** 0xRRGGBBAA, or -1. */
export const parseColor = b.fn({ args: { source: text, current: b.u32 }, returns: b.f64 });
/** The six numbers of `matrix()`, for `DOMMatrix`. Empty if it is invalid. */
export const parseTransform = b.fn({ args: { source: text }, returns: numbers });
/** `name` is what is between `&` and `;`. "" if there is no such entity. */
export const decodeEntity = b.fn({ args: { name: text }, returns: text });
