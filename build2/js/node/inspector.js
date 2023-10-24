(function (){"use strict";// build2/tmp/node/inspector.ts
var open = function() {
  throwNotImplemented("node:inspector open", 2445);
};
var close = function() {
  throwNotImplemented("node:inspector close", 2445);
};
var url = function() {
  throwNotImplemented("node:inspector url", 2445);
};
var waitForDebugger = function() {
  throwNotImplemented("node:inspector waitForDebugger", 2445);
};
var $;
var { hideFromStack, throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector Session", 2445);
  }
}
var console = {
  ...globalThis.console,
  context: {
    console: globalThis.console
  }
};
$ = {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session
};
hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
return $})
