var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/inspector.ts


// Hardcoded module "node:inspector" and "node:inspector/promises"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 6/*internal/shared.ts*/) || __intrinsic__createInternalModuleById(6/*internal/shared.ts*/));
const EventEmitter = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 20/*node:events*/) || __intrinsic__createInternalModuleById(20/*node:events*/));

function open() {
  throwNotImplemented("node:inspector open", 2445);
}

function close() {
  throwNotImplemented("node:inspector close", 2445);
}

function url() {
  throwNotImplemented("node:inspector url", 2445);
}

function waitForDebugger() {
  throwNotImplemented("node:inspector waitForDebugger", 2445);
}

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector Session", 2445);
  }
}

const console = {
  ...globalThis.console,
  context: {
    console: globalThis.console,
  },
};

$ = {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
};

hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
$$EXPORT$$($).$$EXPORT_END$$;
