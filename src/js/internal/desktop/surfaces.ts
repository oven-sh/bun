// Which function gets the events of a surface.
const native = require("internal/desktop/native");

type SurfaceEvent = { t: string; s: number; [key: string]: unknown };

const surfaces = new Map<number, (event: SurfaceEvent) => void>();
const { handlers, hooks } = native;
const mouseActions = ["move", "down", "up", "leave"];
let nextId = 1;

/** While a menu is open, it gets the keys. */
const trap = {
  keys: null as ((event: SurfaceEvent) => void) | null,
  /** Returns whether it took the event. */
  early: null as ((event: SurfaceEvent) => boolean) | null,
};

function route(event: SurfaceEvent) {
  surfaces.$get(event.s)?.(event);
}

function routeInput(event: SurfaceEvent) {
  if (trap.early === null || !trap.early(event)) route(event);
}

hooks.frame = (s, time) => route({ t: "frame", s, time });
hooks.resize = (s, width, height, scale) => route({ t: "resize", s, width, height, scale });
hooks.mouse = (s, x, y, sx, sy, m, action, b, buttons, n) =>
  routeInput({ t: "mouse", s, e: mouseActions[action], x, y, sx, sy, m, b, buttons, n });
hooks.wheel = (s, x, y, sx, sy, m, dx, dy, precise, _phase, isHandled) =>
  route({ t: "wheel", s, x, y, sx, sy, m, dx, dy, precise, isHandled });
hooks.scroll = (s, id, x, y, hasEnded, generation) => route({ t: "scroll", s, id, x, y, hasEnded, generation });
hooks.pinch = (s, x, y, m, delta) => route({ t: "pinch", s, x, y, m, delta });
hooks.key = (s, isDown, key, code, location, repeat, m, composing) => {
  const event = { t: "key", s, e: isDown ? "down" : "up", key, code, location, repeat, m, composing };
  if (trap.keys === null) return routeInput(event);
  native.keyHandled();
  trap.keys(event);
};
hooks.text = (s, text, key, start, end) =>
  trap.keys === null && routeInput({ t: "text", s, text, key, range: start < 0 ? null : [start, end] });
for (const type of ["compose", "composeEnd", "focus", "blur", "drag", "outside", "a11yAction"])
  handlers[type] = route as any;
handlers.a11y = event => surfaces.$forEach((handle, s) => handle({ ...event, s }));

export default { allocateSurfaceId: () => nextId++, surfaces, trap };
