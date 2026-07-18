// Port of Node's lib/internal/process/finalization.js (on-exit-leak-free).

type FinalizationEvent = "exit" | "beforeExit";
type FinalizationCallback = (obj: object, event: FinalizationEvent) => void;
type FinalizationRef = WeakRef<object> & { fn: FinalizationCallback };

let registry: FinalizationRegistry<FinalizationRef> | null = null;

const refs = {
  __proto__: null,
  exit: new Set<FinalizationRef>(),
  beforeExit: new Set<FinalizationRef>(),
} as Record<FinalizationEvent, Set<FinalizationRef>>;

function onExit() {
  callRefsToFree("exit");
}

function onBeforeExit() {
  callRefsToFree("beforeExit");
}

const functions = {
  __proto__: null,
  exit: onExit,
  beforeExit: onBeforeExit,
};

function install(event: FinalizationEvent) {
  if (refs[event].size > 0) {
    return;
  }
  process.on(event, functions[event]);
}

function uninstall(event: FinalizationEvent) {
  if (refs[event].size > 0) {
    return;
  }
  process.removeListener(event, functions[event]);
  if (refs.exit.size === 0 && refs.beforeExit.size === 0) {
    registry = null;
  }
}

function callRefsToFree(event: FinalizationEvent) {
  for (const ref of refs[event]) {
    const obj = ref.deref();
    const fn = ref.fn;
    if (obj !== undefined) {
      fn(obj, event);
    }
  }
  refs[event].clear();
}

function clear(ref: FinalizationRef) {
  if (refs.exit.delete(ref)) uninstall("exit");
  if (refs.beforeExit.delete(ref)) uninstall("beforeExit");
}

function validateFinalizationObject(obj: unknown) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function") || $isJSArray(obj)) {
    throw $ERR_INVALID_ARG_TYPE("obj", "object", obj);
  }
}

function _register(event: FinalizationEvent, obj: object, fn: FinalizationCallback) {
  install(event);

  const ref = new WeakRef(obj) as FinalizationRef;
  ref.fn = fn;

  registry ||= new FinalizationRegistry(clear);
  registry.register(obj, ref, obj);

  refs[event].add(ref);
}

function register(obj: object, fn: FinalizationCallback) {
  validateFinalizationObject(obj);
  _register("exit", obj, fn);
}

function registerBeforeExit(obj: object, fn: FinalizationCallback) {
  validateFinalizationObject(obj);
  _register("beforeExit", obj, fn);
}

function unregister(obj: object) {
  if (!registry) {
    return;
  }
  registry.unregister(obj);
  for (const event of ["exit", "beforeExit"] as const) {
    for (const ref of refs[event]) {
      const _obj = ref.deref();
      if (!_obj || _obj === obj) {
        refs[event].delete(ref);
      }
    }
    uninstall(event);
  }
}

export default {
  register,
  registerBeforeExit,
  unregister,
};
