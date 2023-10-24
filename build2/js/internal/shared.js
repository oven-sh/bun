(function (){"use strict";// build2/tmp/internal/shared.ts
var throwNotImplemented = function(feature, issue) {
  hideFromStack(throwNotImplemented);
  throw new NotImplementedError(feature, issue);
};
var hideFromStack = function(...fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
  }
};
var $;

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError";
    this.code = "ERR_NOT_IMPLEMENTED";
    hideFromStack(NotImplementedError);
  }
}
$ = {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack
};
return $})
