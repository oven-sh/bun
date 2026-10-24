import { inspect } from "node:util";

class HttpError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
  }
  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }
  toJSON() {
    return { name: this.name, status: this.status, message: this.message };
  }
}

function load(id) {
  try {
    if (id < 0) throw new RangeError("negative id");
    return JSON.parse(id === 0 ? "{" : '{"id":' + id + "}");
  } catch (cause) {
    throw new HttpError(id < 0 ? 400 : 500, "cannot load " + id, { cause });
  }
}

for (const id of [1, 0, -1]) {
  try {
    console.log(load(id));
  } catch (error) {
    console.log(error instanceof HttpError, error instanceof Error, error.name, error.status, error.isClientError, error.message, error.cause.name, JSON.stringify(error), String(error), Object.keys(error), Object.prototype.toString.call(error));
    console.log(typeof error.stack, error.stack.split("\n")[0], error.stack.includes("load"), "cause" in error, Object.getOwnPropertyDescriptor(error, "cause").enumerable, Object.getOwnPropertyDescriptor(error, "message").enumerable);
  }
}
const many = new AggregateError([new Error("one"), new TypeError("two")], "several");
console.log(many.errors.map(error => error.message), many.message, many.name, await Promise.any([Promise.reject(1), Promise.reject(2)]).catch(error => error.errors));
console.log(inspect(new HttpError(404, "missing")).split("\n")[0], inspect(new Error("plain", { cause: "text" })).includes("cause"), inspect(Object.assign(new Error("with code"), { code: "E_CODE" })).includes("E_CODE"));
const target = {};
Error.captureStackTrace(target, load);
console.log(typeof target.stack, Error.stackTraceLimit, typeof Error.prepareStackTrace, Error.isError?.(many), Error.isError?.({ message: "fake" }));
const original = Error.prepareStackTrace;
Error.prepareStackTrace = (error, sites) => sites.length > 0 && typeof sites[0].getFileName() + " " + typeof sites[0].getLineNumber() + " " + sites[0].getFunctionName();
console.log((function named() { return new Error("prepared").stack; })());
Error.prepareStackTrace = original;
console.log(new DOMException("gone", "NotFoundError").code, new DOMException("x", "AbortError") instanceof Error, structuredClone(new RangeError("cloned")).message, (() => { try { null.x; } catch (error) { return error.constructor === TypeError; } })(), (() => { try { undefinedName; } catch (error) { return error.name; } })());
const results = await Promise.allSettled([Promise.resolve(1), Promise.reject(new HttpError(418, "teapot")), new Promise((resolve, reject) => setTimeout(reject, 1, "late"))]);
console.log(results.map(result => result.status + ":" + (result.value ?? result.reason?.status ?? result.reason)));
function recurse(n) { return recurse(n + 1) + 1; }
try {
  recurse(0);
} catch (error) {
  console.log(error.name, error.message);
}
