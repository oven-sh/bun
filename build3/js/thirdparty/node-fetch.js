(function (){"use strict";// build3/tmp/thirdparty/node-fetch.ts
async function fetch(url, init) {
  let body = init?.body;
  if (body) {
    const chunks = [];
    if (body instanceof Readable) {
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      init = { ...init, body: new Blob(chunks) };
    }
  }
  const response = await nativeFetch(url, init);
  Object.setPrototypeOf(response, Response.prototype);
  return response;
}
var blobFrom = function(path, options) {
  return @Promise.resolve(Bun.file(path, options));
};
var blobFromSync = function(path, options) {
  return Bun.file(path, options);
};
var isRedirect = function(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
};
var $;
var { Headers, Request, Response: WebResponse, Blob, File = Blob, FormData } = globalThis;
var nativeFetch = Bun.fetch;
var { Readable } = @getInternalField(@internalModuleRegistry, 39) || @createInternalModuleById(39);

class Response extends WebResponse {
  constructor() {
    super(...arguments);
  }
  _body;
  get body() {
    return this._body ?? (this._body = Readable.fromWeb(super.body));
  }
}

class AbortError extends DOMException {
  constructor(message) {
    super(message, "AbortError");
  }
}

class FetchBaseError extends Error {
  type;
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
var fileFrom = blobFrom;
var fileFromSync = blobFromSync;
$ = Object.assign(fetch, {
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
  default: fetch
});
return $})
