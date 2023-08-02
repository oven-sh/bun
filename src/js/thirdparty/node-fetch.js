const { Headers, Request, Response, Blob, File = Blob, FormData } = globalThis;
const realFetch = Bun.fetch;

function fetch(...args) {
  // require("node-fetch") returns the default export which means we need to
  // repeat the ESM exports onto it.
  //
  // We don't want to copy that onto the global fetch object, so we wrap it.
  return realFetch(...args);
}

class AbortError extends DOMException {
  constructor(message) {
    super(message, "AbortError");
  }
}

class FetchBaseError extends Error {
  constructor(message, type) {
    super(message);
    this.type = type;
  }
}

class FetchError extends FetchBaseError {
  constructor(message, type, systemError) {
    super(message, type);
    this.code = systemError?.code;
  }
}

function blobFrom(path, options) {
  return Promise.resolve(Bun.file(data));
}

function blobFromSync(path, options) {
  return Bun.file(data);
}

var fileFrom = blobFrom;
var fileFromSync = blobFromSync;

function isRedirect(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

export default Object.assign(fetch, {
  AbortError,
  Blob,
  FetchBaseError,
  FetchError,
  File,
  FormData,
  Headers,
  Request,
  Response,
  blobFrom,
  blobFromSync,
  fileFrom,
  fileFromSync,
  isRedirect,
  fetch,
});
