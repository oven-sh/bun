// RUN: lower
// OPTIONS: builtin-modules

// Every constructor of the host that needs nothing from outside, entered in four ways, each site spelled out: `new X(..)`, `super(..)` from a class below X, Reflect.construct(X, [..], Other), Reflect.construct(X, [..]).
const EventEmitter = require("node:events");
const { StringDecoder } = require("node:string_decoder");
const { AsyncLocalStorage } = require("node:async_hooks");
const { Script } = require("node:vm");
function describe(label, made, constructor, prototype, first) {
  let brand;
  try { brand = Object.prototype.toString.call(made); } catch (error) { brand = "throws"; }
  console.log(label, typeof made, brand, made instanceof constructor, Object.getPrototypeOf(made) === prototype, made === first, Object.getOwnPropertyNames(made).filter(name => name !== "stack" && name !== "line" && name !== "column" && name !== "sourceURL").join());
}
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}

class BelowBuffer extends Buffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBuffer() {}
OtherBuffer.prototype.mark = "Buffer";
attempt("Buffer new", () => {
  const first = 4;
  const made = new Buffer(first);
  made.extra = 1;
  describe("Buffer new", made, Buffer, Buffer.prototype, first);
  console.log(made.extra);
});
attempt("Buffer super", () => {
  const first = 4;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBuffer(first, i);
    sum += made.own();
  }
  describe("Buffer super", made, Buffer, BelowBuffer.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBuffer);
});
attempt("Buffer reflected", () => {
  const first = 4;
  const made = Reflect.construct(Buffer, [first], OtherBuffer);
  made.extra = 1;
  describe("Buffer reflected", made, Buffer, OtherBuffer.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Buffer reflected for itself", () => {
  const first = 4;
  const made = Reflect.construct(Buffer, [first]);
  describe("Buffer reflected for itself", made, Buffer, Buffer.prototype, first);
});

class BelowBufferOfText extends Buffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBufferOfText() {}
OtherBufferOfText.prototype.mark = "BufferOfText";
attempt("BufferOfText new", () => {
  const first = "text";
  const made = new Buffer(first);
  made.extra = 1;
  describe("BufferOfText new", made, Buffer, Buffer.prototype, first);
  console.log(made.extra);
});
attempt("BufferOfText super", () => {
  const first = "text";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBufferOfText(first, i);
    sum += made.own();
  }
  describe("BufferOfText super", made, Buffer, BelowBufferOfText.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBufferOfText);
});
attempt("BufferOfText reflected", () => {
  const first = "text";
  const made = Reflect.construct(Buffer, [first], OtherBufferOfText);
  made.extra = 1;
  describe("BufferOfText reflected", made, Buffer, OtherBufferOfText.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("BufferOfText reflected for itself", () => {
  const first = "text";
  const made = Reflect.construct(Buffer, [first]);
  describe("BufferOfText reflected for itself", made, Buffer, Buffer.prototype, first);
});

class BelowBufferOfBuffer extends Buffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBufferOfBuffer() {}
OtherBufferOfBuffer.prototype.mark = "BufferOfBuffer";
attempt("BufferOfBuffer new", () => {
  const first = new ArrayBuffer(8);
  const made = new Buffer(first);
  made.extra = 1;
  describe("BufferOfBuffer new", made, Buffer, Buffer.prototype, first);
  console.log(made.extra);
});
attempt("BufferOfBuffer super", () => {
  const first = new ArrayBuffer(8);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBufferOfBuffer(first, i);
    sum += made.own();
  }
  describe("BufferOfBuffer super", made, Buffer, BelowBufferOfBuffer.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBufferOfBuffer);
});
attempt("BufferOfBuffer reflected", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(Buffer, [first], OtherBufferOfBuffer);
  made.extra = 1;
  describe("BufferOfBuffer reflected", made, Buffer, OtherBufferOfBuffer.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("BufferOfBuffer reflected for itself", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(Buffer, [first]);
  describe("BufferOfBuffer reflected for itself", made, Buffer, Buffer.prototype, first);
});

class BelowBufferOfList extends Buffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBufferOfList() {}
OtherBufferOfList.prototype.mark = "BufferOfList";
attempt("BufferOfList new", () => {
  const first = [1, 2];
  const made = new Buffer(first);
  made.extra = 1;
  describe("BufferOfList new", made, Buffer, Buffer.prototype, first);
  console.log(made.extra);
});
attempt("BufferOfList super", () => {
  const first = [1, 2];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBufferOfList(first, i);
    sum += made.own();
  }
  describe("BufferOfList super", made, Buffer, BelowBufferOfList.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBufferOfList);
});
attempt("BufferOfList reflected", () => {
  const first = [1, 2];
  const made = Reflect.construct(Buffer, [first], OtherBufferOfList);
  made.extra = 1;
  describe("BufferOfList reflected", made, Buffer, OtherBufferOfList.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("BufferOfList reflected for itself", () => {
  const first = [1, 2];
  const made = Reflect.construct(Buffer, [first]);
  describe("BufferOfList reflected for itself", made, Buffer, Buffer.prototype, first);
});

class BelowURL extends URL {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherURL() {}
OtherURL.prototype.mark = "URL";
attempt("URL new", () => {
  const first = "http://a.example/";
  const made = new URL(first);
  made.extra = 1;
  describe("URL new", made, URL, URL.prototype, first);
  console.log(made.extra);
});
attempt("URL super", () => {
  const first = "http://a.example/";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowURL(first, i);
    sum += made.own();
  }
  describe("URL super", made, URL, BelowURL.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowURL);
});
attempt("URL reflected", () => {
  const first = "http://a.example/";
  const made = Reflect.construct(URL, [first], OtherURL);
  made.extra = 1;
  describe("URL reflected", made, URL, OtherURL.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("URL reflected for itself", () => {
  const first = "http://a.example/";
  const made = Reflect.construct(URL, [first]);
  describe("URL reflected for itself", made, URL, URL.prototype, first);
});

class BelowURLSearchParams extends URLSearchParams {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherURLSearchParams() {}
OtherURLSearchParams.prototype.mark = "URLSearchParams";
attempt("URLSearchParams new", () => {
  const first = "a=1";
  const made = new URLSearchParams(first);
  made.extra = 1;
  describe("URLSearchParams new", made, URLSearchParams, URLSearchParams.prototype, first);
  console.log(made.extra);
});
attempt("URLSearchParams super", () => {
  const first = "a=1";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowURLSearchParams(first, i);
    sum += made.own();
  }
  describe("URLSearchParams super", made, URLSearchParams, BelowURLSearchParams.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowURLSearchParams);
});
attempt("URLSearchParams reflected", () => {
  const first = "a=1";
  const made = Reflect.construct(URLSearchParams, [first], OtherURLSearchParams);
  made.extra = 1;
  describe("URLSearchParams reflected", made, URLSearchParams, OtherURLSearchParams.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("URLSearchParams reflected for itself", () => {
  const first = "a=1";
  const made = Reflect.construct(URLSearchParams, [first]);
  describe("URLSearchParams reflected for itself", made, URLSearchParams, URLSearchParams.prototype, first);
});

class BelowHeaders extends Headers {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherHeaders() {}
OtherHeaders.prototype.mark = "Headers";
attempt("Headers new", () => {
  const first = { a: '1' };
  const made = new Headers(first);
  made.extra = 1;
  describe("Headers new", made, Headers, Headers.prototype, first);
  console.log(made.extra);
});
attempt("Headers super", () => {
  const first = { a: '1' };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowHeaders(first, i);
    sum += made.own();
  }
  describe("Headers super", made, Headers, BelowHeaders.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowHeaders);
});
attempt("Headers reflected", () => {
  const first = { a: '1' };
  const made = Reflect.construct(Headers, [first], OtherHeaders);
  made.extra = 1;
  describe("Headers reflected", made, Headers, OtherHeaders.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Headers reflected for itself", () => {
  const first = { a: '1' };
  const made = Reflect.construct(Headers, [first]);
  describe("Headers reflected for itself", made, Headers, Headers.prototype, first);
});

class BelowHeadersOfHeaders extends Headers {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherHeadersOfHeaders() {}
OtherHeadersOfHeaders.prototype.mark = "HeadersOfHeaders";
attempt("HeadersOfHeaders new", () => {
  const first = new Headers({ a: '1' });
  const made = new Headers(first);
  made.extra = 1;
  describe("HeadersOfHeaders new", made, Headers, Headers.prototype, first);
  console.log(made.extra);
});
attempt("HeadersOfHeaders super", () => {
  const first = new Headers({ a: '1' });
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowHeadersOfHeaders(first, i);
    sum += made.own();
  }
  describe("HeadersOfHeaders super", made, Headers, BelowHeadersOfHeaders.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowHeadersOfHeaders);
});
attempt("HeadersOfHeaders reflected", () => {
  const first = new Headers({ a: '1' });
  const made = Reflect.construct(Headers, [first], OtherHeadersOfHeaders);
  made.extra = 1;
  describe("HeadersOfHeaders reflected", made, Headers, OtherHeadersOfHeaders.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("HeadersOfHeaders reflected for itself", () => {
  const first = new Headers({ a: '1' });
  const made = Reflect.construct(Headers, [first]);
  describe("HeadersOfHeaders reflected for itself", made, Headers, Headers.prototype, first);
});

class BelowRequest extends Request {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherRequest() {}
OtherRequest.prototype.mark = "Request";
attempt("Request new", () => {
  const first = "http://a.example/";
  const made = new Request(first);
  made.extra = 1;
  describe("Request new", made, Request, Request.prototype, first);
  console.log(made.extra);
});
attempt("Request super", () => {
  const first = "http://a.example/";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowRequest(first, i);
    sum += made.own();
  }
  describe("Request super", made, Request, BelowRequest.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowRequest);
});
attempt("Request reflected", () => {
  const first = "http://a.example/";
  const made = Reflect.construct(Request, [first], OtherRequest);
  made.extra = 1;
  describe("Request reflected", made, Request, OtherRequest.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Request reflected for itself", () => {
  const first = "http://a.example/";
  const made = Reflect.construct(Request, [first]);
  describe("Request reflected for itself", made, Request, Request.prototype, first);
});

class BelowRequestOfRequest extends Request {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherRequestOfRequest() {}
OtherRequestOfRequest.prototype.mark = "RequestOfRequest";
attempt("RequestOfRequest new", () => {
  const first = new Request("http://a.example/");
  const made = new Request(first);
  made.extra = 1;
  describe("RequestOfRequest new", made, Request, Request.prototype, first);
  console.log(made.extra);
});
attempt("RequestOfRequest super", () => {
  const first = new Request("http://a.example/");
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowRequestOfRequest(first, i);
    sum += made.own();
  }
  describe("RequestOfRequest super", made, Request, BelowRequestOfRequest.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowRequestOfRequest);
});
attempt("RequestOfRequest reflected", () => {
  const first = new Request("http://a.example/");
  const made = Reflect.construct(Request, [first], OtherRequestOfRequest);
  made.extra = 1;
  describe("RequestOfRequest reflected", made, Request, OtherRequestOfRequest.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("RequestOfRequest reflected for itself", () => {
  const first = new Request("http://a.example/");
  const made = Reflect.construct(Request, [first]);
  describe("RequestOfRequest reflected for itself", made, Request, Request.prototype, first);
});

class BelowResponse extends Response {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherResponse() {}
OtherResponse.prototype.mark = "Response";
attempt("Response new", () => {
  const first = "body";
  const made = new Response(first);
  made.extra = 1;
  describe("Response new", made, Response, Response.prototype, first);
  console.log(made.extra);
});
attempt("Response super", () => {
  const first = "body";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowResponse(first, i);
    sum += made.own();
  }
  describe("Response super", made, Response, BelowResponse.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowResponse);
});
attempt("Response reflected", () => {
  const first = "body";
  const made = Reflect.construct(Response, [first], OtherResponse);
  made.extra = 1;
  describe("Response reflected", made, Response, OtherResponse.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Response reflected for itself", () => {
  const first = "body";
  const made = Reflect.construct(Response, [first]);
  describe("Response reflected for itself", made, Response, Response.prototype, first);
});

class BelowBlob extends Blob {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBlob() {}
OtherBlob.prototype.mark = "Blob";
attempt("Blob new", () => {
  const first = ["x"];
  const made = new Blob(first);
  made.extra = 1;
  describe("Blob new", made, Blob, Blob.prototype, first);
  console.log(made.extra);
});
attempt("Blob super", () => {
  const first = ["x"];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBlob(first, i);
    sum += made.own();
  }
  describe("Blob super", made, Blob, BelowBlob.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBlob);
});
attempt("Blob reflected", () => {
  const first = ["x"];
  const made = Reflect.construct(Blob, [first], OtherBlob);
  made.extra = 1;
  describe("Blob reflected", made, Blob, OtherBlob.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Blob reflected for itself", () => {
  const first = ["x"];
  const made = Reflect.construct(Blob, [first]);
  describe("Blob reflected for itself", made, Blob, Blob.prototype, first);
});

class BelowFile extends File {
  tag;
  constructor(first, second, tag) {
    super(first, second);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherFile() {}
OtherFile.prototype.mark = "File";
attempt("File new", () => {
  const first = ["x"];
  const second = "name";
  const made = new File(first, second);
  made.extra = 1;
  describe("File new", made, File, File.prototype, first);
  console.log(made.extra);
});
attempt("File super", () => {
  const first = ["x"];
  const second = "name";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowFile(first, second, i);
    sum += made.own();
  }
  describe("File super", made, File, BelowFile.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowFile);
});
attempt("File reflected", () => {
  const first = ["x"];
  const second = "name";
  const made = Reflect.construct(File, [first, second], OtherFile);
  made.extra = 1;
  describe("File reflected", made, File, OtherFile.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("File reflected for itself", () => {
  const first = ["x"];
  const second = "name";
  const made = Reflect.construct(File, [first, second]);
  describe("File reflected for itself", made, File, File.prototype, first);
});

class BelowFormData extends FormData {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherFormData() {}
OtherFormData.prototype.mark = "FormData";
attempt("FormData new", () => {
  const made = new FormData();
  made.extra = 1;
  describe("FormData new", made, FormData, FormData.prototype, undefined);
  console.log(made.extra);
});
attempt("FormData super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowFormData(i);
    sum += made.own();
  }
  describe("FormData super", made, FormData, BelowFormData.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowFormData);
});
attempt("FormData reflected", () => {
  const made = Reflect.construct(FormData, [], OtherFormData);
  made.extra = 1;
  describe("FormData reflected", made, FormData, OtherFormData.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("FormData reflected for itself", () => {
  const made = Reflect.construct(FormData, []);
  describe("FormData reflected for itself", made, FormData, FormData.prototype, undefined);
});

class BelowTextEncoder extends TextEncoder {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTextEncoder() {}
OtherTextEncoder.prototype.mark = "TextEncoder";
attempt("TextEncoder new", () => {
  const made = new TextEncoder();
  made.extra = 1;
  describe("TextEncoder new", made, TextEncoder, TextEncoder.prototype, undefined);
  console.log(made.extra);
});
attempt("TextEncoder super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTextEncoder(i);
    sum += made.own();
  }
  describe("TextEncoder super", made, TextEncoder, BelowTextEncoder.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTextEncoder);
});
attempt("TextEncoder reflected", () => {
  const made = Reflect.construct(TextEncoder, [], OtherTextEncoder);
  made.extra = 1;
  describe("TextEncoder reflected", made, TextEncoder, OtherTextEncoder.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("TextEncoder reflected for itself", () => {
  const made = Reflect.construct(TextEncoder, []);
  describe("TextEncoder reflected for itself", made, TextEncoder, TextEncoder.prototype, undefined);
});

class BelowTextDecoder extends TextDecoder {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTextDecoder() {}
OtherTextDecoder.prototype.mark = "TextDecoder";
attempt("TextDecoder new", () => {
  const made = new TextDecoder();
  made.extra = 1;
  describe("TextDecoder new", made, TextDecoder, TextDecoder.prototype, undefined);
  console.log(made.extra);
});
attempt("TextDecoder super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTextDecoder(i);
    sum += made.own();
  }
  describe("TextDecoder super", made, TextDecoder, BelowTextDecoder.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTextDecoder);
});
attempt("TextDecoder reflected", () => {
  const made = Reflect.construct(TextDecoder, [], OtherTextDecoder);
  made.extra = 1;
  describe("TextDecoder reflected", made, TextDecoder, OtherTextDecoder.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("TextDecoder reflected for itself", () => {
  const made = Reflect.construct(TextDecoder, []);
  describe("TextDecoder reflected for itself", made, TextDecoder, TextDecoder.prototype, undefined);
});

class BelowAbortController extends AbortController {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherAbortController() {}
OtherAbortController.prototype.mark = "AbortController";
attempt("AbortController new", () => {
  const made = new AbortController();
  made.extra = 1;
  describe("AbortController new", made, AbortController, AbortController.prototype, undefined);
  console.log(made.extra);
});
attempt("AbortController super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowAbortController(i);
    sum += made.own();
  }
  describe("AbortController super", made, AbortController, BelowAbortController.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowAbortController);
});
attempt("AbortController reflected", () => {
  const made = Reflect.construct(AbortController, [], OtherAbortController);
  made.extra = 1;
  describe("AbortController reflected", made, AbortController, OtherAbortController.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("AbortController reflected for itself", () => {
  const made = Reflect.construct(AbortController, []);
  describe("AbortController reflected for itself", made, AbortController, AbortController.prototype, undefined);
});

class BelowEvent extends Event {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherEvent() {}
OtherEvent.prototype.mark = "Event";
attempt("Event new", () => {
  const first = "x";
  const made = new Event(first);
  made.extra = 1;
  describe("Event new", made, Event, Event.prototype, first);
  console.log(made.extra);
});
attempt("Event super", () => {
  const first = "x";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowEvent(first, i);
    sum += made.own();
  }
  describe("Event super", made, Event, BelowEvent.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowEvent);
});
attempt("Event reflected", () => {
  const first = "x";
  const made = Reflect.construct(Event, [first], OtherEvent);
  made.extra = 1;
  describe("Event reflected", made, Event, OtherEvent.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Event reflected for itself", () => {
  const first = "x";
  const made = Reflect.construct(Event, [first]);
  describe("Event reflected for itself", made, Event, Event.prototype, first);
});

class BelowEventTarget extends EventTarget {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherEventTarget() {}
OtherEventTarget.prototype.mark = "EventTarget";
attempt("EventTarget new", () => {
  const made = new EventTarget();
  made.extra = 1;
  describe("EventTarget new", made, EventTarget, EventTarget.prototype, undefined);
  console.log(made.extra);
});
attempt("EventTarget super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowEventTarget(i);
    sum += made.own();
  }
  describe("EventTarget super", made, EventTarget, BelowEventTarget.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowEventTarget);
});
attempt("EventTarget reflected", () => {
  const made = Reflect.construct(EventTarget, [], OtherEventTarget);
  made.extra = 1;
  describe("EventTarget reflected", made, EventTarget, OtherEventTarget.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("EventTarget reflected for itself", () => {
  const made = Reflect.construct(EventTarget, []);
  describe("EventTarget reflected for itself", made, EventTarget, EventTarget.prototype, undefined);
});

class BelowCustomEvent extends CustomEvent {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCustomEvent() {}
OtherCustomEvent.prototype.mark = "CustomEvent";
attempt("CustomEvent new", () => {
  const first = "x";
  const made = new CustomEvent(first);
  made.extra = 1;
  describe("CustomEvent new", made, CustomEvent, CustomEvent.prototype, first);
  console.log(made.extra);
});
attempt("CustomEvent super", () => {
  const first = "x";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCustomEvent(first, i);
    sum += made.own();
  }
  describe("CustomEvent super", made, CustomEvent, BelowCustomEvent.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCustomEvent);
});
attempt("CustomEvent reflected", () => {
  const first = "x";
  const made = Reflect.construct(CustomEvent, [first], OtherCustomEvent);
  made.extra = 1;
  describe("CustomEvent reflected", made, CustomEvent, OtherCustomEvent.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("CustomEvent reflected for itself", () => {
  const first = "x";
  const made = Reflect.construct(CustomEvent, [first]);
  describe("CustomEvent reflected for itself", made, CustomEvent, CustomEvent.prototype, first);
});

class BelowMessageEvent extends MessageEvent {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherMessageEvent() {}
OtherMessageEvent.prototype.mark = "MessageEvent";
attempt("MessageEvent new", () => {
  const first = "x";
  const made = new MessageEvent(first);
  made.extra = 1;
  describe("MessageEvent new", made, MessageEvent, MessageEvent.prototype, first);
  console.log(made.extra);
});
attempt("MessageEvent super", () => {
  const first = "x";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowMessageEvent(first, i);
    sum += made.own();
  }
  describe("MessageEvent super", made, MessageEvent, BelowMessageEvent.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowMessageEvent);
});
attempt("MessageEvent reflected", () => {
  const first = "x";
  const made = Reflect.construct(MessageEvent, [first], OtherMessageEvent);
  made.extra = 1;
  describe("MessageEvent reflected", made, MessageEvent, OtherMessageEvent.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("MessageEvent reflected for itself", () => {
  const first = "x";
  const made = Reflect.construct(MessageEvent, [first]);
  describe("MessageEvent reflected for itself", made, MessageEvent, MessageEvent.prototype, first);
});

class BelowErrorEvent extends ErrorEvent {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherErrorEvent() {}
OtherErrorEvent.prototype.mark = "ErrorEvent";
attempt("ErrorEvent new", () => {
  const first = "x";
  const made = new ErrorEvent(first);
  made.extra = 1;
  describe("ErrorEvent new", made, ErrorEvent, ErrorEvent.prototype, first);
  console.log(made.extra);
});
attempt("ErrorEvent super", () => {
  const first = "x";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowErrorEvent(first, i);
    sum += made.own();
  }
  describe("ErrorEvent super", made, ErrorEvent, BelowErrorEvent.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowErrorEvent);
});
attempt("ErrorEvent reflected", () => {
  const first = "x";
  const made = Reflect.construct(ErrorEvent, [first], OtherErrorEvent);
  made.extra = 1;
  describe("ErrorEvent reflected", made, ErrorEvent, OtherErrorEvent.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ErrorEvent reflected for itself", () => {
  const first = "x";
  const made = Reflect.construct(ErrorEvent, [first]);
  describe("ErrorEvent reflected for itself", made, ErrorEvent, ErrorEvent.prototype, first);
});

class BelowCloseEvent extends CloseEvent {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCloseEvent() {}
OtherCloseEvent.prototype.mark = "CloseEvent";
attempt("CloseEvent new", () => {
  const first = "x";
  const made = new CloseEvent(first);
  made.extra = 1;
  describe("CloseEvent new", made, CloseEvent, CloseEvent.prototype, first);
  console.log(made.extra);
});
attempt("CloseEvent super", () => {
  const first = "x";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCloseEvent(first, i);
    sum += made.own();
  }
  describe("CloseEvent super", made, CloseEvent, BelowCloseEvent.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCloseEvent);
});
attempt("CloseEvent reflected", () => {
  const first = "x";
  const made = Reflect.construct(CloseEvent, [first], OtherCloseEvent);
  made.extra = 1;
  describe("CloseEvent reflected", made, CloseEvent, OtherCloseEvent.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("CloseEvent reflected for itself", () => {
  const first = "x";
  const made = Reflect.construct(CloseEvent, [first]);
  describe("CloseEvent reflected for itself", made, CloseEvent, CloseEvent.prototype, first);
});

class BelowDOMException extends DOMException {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherDOMException() {}
OtherDOMException.prototype.mark = "DOMException";
attempt("DOMException new", () => {
  const first = "message";
  const made = new DOMException(first);
  made.extra = 1;
  describe("DOMException new", made, DOMException, DOMException.prototype, first);
  console.log(made.extra);
});
attempt("DOMException super", () => {
  const first = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowDOMException(first, i);
    sum += made.own();
  }
  describe("DOMException super", made, DOMException, BelowDOMException.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowDOMException);
});
attempt("DOMException reflected", () => {
  const first = "message";
  const made = Reflect.construct(DOMException, [first], OtherDOMException);
  made.extra = 1;
  describe("DOMException reflected", made, DOMException, OtherDOMException.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("DOMException reflected for itself", () => {
  const first = "message";
  const made = Reflect.construct(DOMException, [first]);
  describe("DOMException reflected for itself", made, DOMException, DOMException.prototype, first);
});

class BelowReadableStream extends ReadableStream {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherReadableStream() {}
OtherReadableStream.prototype.mark = "ReadableStream";
attempt("ReadableStream new", () => {
  const made = new ReadableStream();
  made.extra = 1;
  describe("ReadableStream new", made, ReadableStream, ReadableStream.prototype, undefined);
  console.log(made.extra);
});
attempt("ReadableStream super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowReadableStream(i);
    sum += made.own();
  }
  describe("ReadableStream super", made, ReadableStream, BelowReadableStream.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowReadableStream);
});
attempt("ReadableStream reflected", () => {
  const made = Reflect.construct(ReadableStream, [], OtherReadableStream);
  made.extra = 1;
  describe("ReadableStream reflected", made, ReadableStream, OtherReadableStream.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("ReadableStream reflected for itself", () => {
  const made = Reflect.construct(ReadableStream, []);
  describe("ReadableStream reflected for itself", made, ReadableStream, ReadableStream.prototype, undefined);
});

class BelowWritableStream extends WritableStream {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherWritableStream() {}
OtherWritableStream.prototype.mark = "WritableStream";
attempt("WritableStream new", () => {
  const made = new WritableStream();
  made.extra = 1;
  describe("WritableStream new", made, WritableStream, WritableStream.prototype, undefined);
  console.log(made.extra);
});
attempt("WritableStream super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowWritableStream(i);
    sum += made.own();
  }
  describe("WritableStream super", made, WritableStream, BelowWritableStream.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowWritableStream);
});
attempt("WritableStream reflected", () => {
  const made = Reflect.construct(WritableStream, [], OtherWritableStream);
  made.extra = 1;
  describe("WritableStream reflected", made, WritableStream, OtherWritableStream.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("WritableStream reflected for itself", () => {
  const made = Reflect.construct(WritableStream, []);
  describe("WritableStream reflected for itself", made, WritableStream, WritableStream.prototype, undefined);
});

class BelowTransformStream extends TransformStream {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTransformStream() {}
OtherTransformStream.prototype.mark = "TransformStream";
attempt("TransformStream new", () => {
  const made = new TransformStream();
  made.extra = 1;
  describe("TransformStream new", made, TransformStream, TransformStream.prototype, undefined);
  console.log(made.extra);
});
attempt("TransformStream super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTransformStream(i);
    sum += made.own();
  }
  describe("TransformStream super", made, TransformStream, BelowTransformStream.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTransformStream);
});
attempt("TransformStream reflected", () => {
  const made = Reflect.construct(TransformStream, [], OtherTransformStream);
  made.extra = 1;
  describe("TransformStream reflected", made, TransformStream, OtherTransformStream.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("TransformStream reflected for itself", () => {
  const made = Reflect.construct(TransformStream, []);
  describe("TransformStream reflected for itself", made, TransformStream, TransformStream.prototype, undefined);
});

class BelowByteLengthQueuingStrategy extends ByteLengthQueuingStrategy {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherByteLengthQueuingStrategy() {}
OtherByteLengthQueuingStrategy.prototype.mark = "ByteLengthQueuingStrategy";
attempt("ByteLengthQueuingStrategy new", () => {
  const first = { highWaterMark: 1 };
  const made = new ByteLengthQueuingStrategy(first);
  made.extra = 1;
  describe("ByteLengthQueuingStrategy new", made, ByteLengthQueuingStrategy, ByteLengthQueuingStrategy.prototype, first);
  console.log(made.extra);
});
attempt("ByteLengthQueuingStrategy super", () => {
  const first = { highWaterMark: 1 };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowByteLengthQueuingStrategy(first, i);
    sum += made.own();
  }
  describe("ByteLengthQueuingStrategy super", made, ByteLengthQueuingStrategy, BelowByteLengthQueuingStrategy.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowByteLengthQueuingStrategy);
});
attempt("ByteLengthQueuingStrategy reflected", () => {
  const first = { highWaterMark: 1 };
  const made = Reflect.construct(ByteLengthQueuingStrategy, [first], OtherByteLengthQueuingStrategy);
  made.extra = 1;
  describe("ByteLengthQueuingStrategy reflected", made, ByteLengthQueuingStrategy, OtherByteLengthQueuingStrategy.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ByteLengthQueuingStrategy reflected for itself", () => {
  const first = { highWaterMark: 1 };
  const made = Reflect.construct(ByteLengthQueuingStrategy, [first]);
  describe("ByteLengthQueuingStrategy reflected for itself", made, ByteLengthQueuingStrategy, ByteLengthQueuingStrategy.prototype, first);
});

class BelowCountQueuingStrategy extends CountQueuingStrategy {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCountQueuingStrategy() {}
OtherCountQueuingStrategy.prototype.mark = "CountQueuingStrategy";
attempt("CountQueuingStrategy new", () => {
  const first = { highWaterMark: 1 };
  const made = new CountQueuingStrategy(first);
  made.extra = 1;
  describe("CountQueuingStrategy new", made, CountQueuingStrategy, CountQueuingStrategy.prototype, first);
  console.log(made.extra);
});
attempt("CountQueuingStrategy super", () => {
  const first = { highWaterMark: 1 };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCountQueuingStrategy(first, i);
    sum += made.own();
  }
  describe("CountQueuingStrategy super", made, CountQueuingStrategy, BelowCountQueuingStrategy.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCountQueuingStrategy);
});
attempt("CountQueuingStrategy reflected", () => {
  const first = { highWaterMark: 1 };
  const made = Reflect.construct(CountQueuingStrategy, [first], OtherCountQueuingStrategy);
  made.extra = 1;
  describe("CountQueuingStrategy reflected", made, CountQueuingStrategy, OtherCountQueuingStrategy.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("CountQueuingStrategy reflected for itself", () => {
  const first = { highWaterMark: 1 };
  const made = Reflect.construct(CountQueuingStrategy, [first]);
  describe("CountQueuingStrategy reflected for itself", made, CountQueuingStrategy, CountQueuingStrategy.prototype, first);
});

class BelowTextDecoderStream extends TextDecoderStream {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTextDecoderStream() {}
OtherTextDecoderStream.prototype.mark = "TextDecoderStream";
attempt("TextDecoderStream new", () => {
  const made = new TextDecoderStream();
  made.extra = 1;
  describe("TextDecoderStream new", made, TextDecoderStream, TextDecoderStream.prototype, undefined);
  console.log(made.extra);
});
attempt("TextDecoderStream super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTextDecoderStream(i);
    sum += made.own();
  }
  describe("TextDecoderStream super", made, TextDecoderStream, BelowTextDecoderStream.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTextDecoderStream);
});
attempt("TextDecoderStream reflected", () => {
  const made = Reflect.construct(TextDecoderStream, [], OtherTextDecoderStream);
  made.extra = 1;
  describe("TextDecoderStream reflected", made, TextDecoderStream, OtherTextDecoderStream.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("TextDecoderStream reflected for itself", () => {
  const made = Reflect.construct(TextDecoderStream, []);
  describe("TextDecoderStream reflected for itself", made, TextDecoderStream, TextDecoderStream.prototype, undefined);
});

class BelowTextEncoderStream extends TextEncoderStream {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTextEncoderStream() {}
OtherTextEncoderStream.prototype.mark = "TextEncoderStream";
attempt("TextEncoderStream new", () => {
  const made = new TextEncoderStream();
  made.extra = 1;
  describe("TextEncoderStream new", made, TextEncoderStream, TextEncoderStream.prototype, undefined);
  console.log(made.extra);
});
attempt("TextEncoderStream super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTextEncoderStream(i);
    sum += made.own();
  }
  describe("TextEncoderStream super", made, TextEncoderStream, BelowTextEncoderStream.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTextEncoderStream);
});
attempt("TextEncoderStream reflected", () => {
  const made = Reflect.construct(TextEncoderStream, [], OtherTextEncoderStream);
  made.extra = 1;
  describe("TextEncoderStream reflected", made, TextEncoderStream, OtherTextEncoderStream.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("TextEncoderStream reflected for itself", () => {
  const made = Reflect.construct(TextEncoderStream, []);
  describe("TextEncoderStream reflected for itself", made, TextEncoderStream, TextEncoderStream.prototype, undefined);
});

class BelowCompressionStream extends CompressionStream {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCompressionStream() {}
OtherCompressionStream.prototype.mark = "CompressionStream";
attempt("CompressionStream new", () => {
  const first = "gzip";
  const made = new CompressionStream(first);
  made.extra = 1;
  describe("CompressionStream new", made, CompressionStream, CompressionStream.prototype, first);
  console.log(made.extra);
});
attempt("CompressionStream super", () => {
  const first = "gzip";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCompressionStream(first, i);
    sum += made.own();
  }
  describe("CompressionStream super", made, CompressionStream, BelowCompressionStream.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCompressionStream);
});
attempt("CompressionStream reflected", () => {
  const first = "gzip";
  const made = Reflect.construct(CompressionStream, [first], OtherCompressionStream);
  made.extra = 1;
  describe("CompressionStream reflected", made, CompressionStream, OtherCompressionStream.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("CompressionStream reflected for itself", () => {
  const first = "gzip";
  const made = Reflect.construct(CompressionStream, [first]);
  describe("CompressionStream reflected for itself", made, CompressionStream, CompressionStream.prototype, first);
});

class BelowTranspiler extends Bun.Transpiler {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTranspiler() {}
OtherTranspiler.prototype.mark = "Transpiler";
attempt("Transpiler new", () => {
  const made = new Bun.Transpiler();
  made.extra = 1;
  describe("Transpiler new", made, Bun.Transpiler, Bun.Transpiler.prototype, undefined);
  console.log(made.extra);
});
attempt("Transpiler super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTranspiler(i);
    sum += made.own();
  }
  describe("Transpiler super", made, Bun.Transpiler, BelowTranspiler.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowTranspiler);
});
attempt("Transpiler reflected", () => {
  const made = Reflect.construct(Bun.Transpiler, [], OtherTranspiler);
  made.extra = 1;
  describe("Transpiler reflected", made, Bun.Transpiler, OtherTranspiler.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("Transpiler reflected for itself", () => {
  const made = Reflect.construct(Bun.Transpiler, []);
  describe("Transpiler reflected for itself", made, Bun.Transpiler, Bun.Transpiler.prototype, undefined);
});

class BelowGlob extends Bun.Glob {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherGlob() {}
OtherGlob.prototype.mark = "Glob";
attempt("Glob new", () => {
  const first = "*";
  const made = new Bun.Glob(first);
  made.extra = 1;
  describe("Glob new", made, Bun.Glob, Bun.Glob.prototype, first);
  console.log(made.extra);
});
attempt("Glob super", () => {
  const first = "*";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowGlob(first, i);
    sum += made.own();
  }
  describe("Glob super", made, Bun.Glob, BelowGlob.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowGlob);
});
attempt("Glob reflected", () => {
  const first = "*";
  const made = Reflect.construct(Bun.Glob, [first], OtherGlob);
  made.extra = 1;
  describe("Glob reflected", made, Bun.Glob, OtherGlob.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Glob reflected for itself", () => {
  const first = "*";
  const made = Reflect.construct(Bun.Glob, [first]);
  describe("Glob reflected for itself", made, Bun.Glob, Bun.Glob.prototype, first);
});

class BelowCryptoHasher extends Bun.CryptoHasher {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCryptoHasher() {}
OtherCryptoHasher.prototype.mark = "CryptoHasher";
attempt("CryptoHasher new", () => {
  const first = "sha1";
  const made = new Bun.CryptoHasher(first);
  made.extra = 1;
  describe("CryptoHasher new", made, Bun.CryptoHasher, Bun.CryptoHasher.prototype, first);
  console.log(made.extra);
});
attempt("CryptoHasher super", () => {
  const first = "sha1";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCryptoHasher(first, i);
    sum += made.own();
  }
  describe("CryptoHasher super", made, Bun.CryptoHasher, BelowCryptoHasher.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCryptoHasher);
});
attempt("CryptoHasher reflected", () => {
  const first = "sha1";
  const made = Reflect.construct(Bun.CryptoHasher, [first], OtherCryptoHasher);
  made.extra = 1;
  describe("CryptoHasher reflected", made, Bun.CryptoHasher, OtherCryptoHasher.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("CryptoHasher reflected for itself", () => {
  const first = "sha1";
  const made = Reflect.construct(Bun.CryptoHasher, [first]);
  describe("CryptoHasher reflected for itself", made, Bun.CryptoHasher, Bun.CryptoHasher.prototype, first);
});

class BelowSHA1 extends Bun.SHA1 {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSHA1() {}
OtherSHA1.prototype.mark = "SHA1";
attempt("SHA1 new", () => {
  const made = new Bun.SHA1();
  made.extra = 1;
  describe("SHA1 new", made, Bun.SHA1, Bun.SHA1.prototype, undefined);
  console.log(made.extra);
});
attempt("SHA1 super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSHA1(i);
    sum += made.own();
  }
  describe("SHA1 super", made, Bun.SHA1, BelowSHA1.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowSHA1);
});
attempt("SHA1 reflected", () => {
  const made = Reflect.construct(Bun.SHA1, [], OtherSHA1);
  made.extra = 1;
  describe("SHA1 reflected", made, Bun.SHA1, OtherSHA1.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("SHA1 reflected for itself", () => {
  const made = Reflect.construct(Bun.SHA1, []);
  describe("SHA1 reflected for itself", made, Bun.SHA1, Bun.SHA1.prototype, undefined);
});

class BelowMD5 extends Bun.MD5 {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherMD5() {}
OtherMD5.prototype.mark = "MD5";
attempt("MD5 new", () => {
  const made = new Bun.MD5();
  made.extra = 1;
  describe("MD5 new", made, Bun.MD5, Bun.MD5.prototype, undefined);
  console.log(made.extra);
});
attempt("MD5 super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowMD5(i);
    sum += made.own();
  }
  describe("MD5 super", made, Bun.MD5, BelowMD5.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowMD5);
});
attempt("MD5 reflected", () => {
  const made = Reflect.construct(Bun.MD5, [], OtherMD5);
  made.extra = 1;
  describe("MD5 reflected", made, Bun.MD5, OtherMD5.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("MD5 reflected for itself", () => {
  const made = Reflect.construct(Bun.MD5, []);
  describe("MD5 reflected for itself", made, Bun.MD5, Bun.MD5.prototype, undefined);
});

class BelowSHA256 extends Bun.SHA256 {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSHA256() {}
OtherSHA256.prototype.mark = "SHA256";
attempt("SHA256 new", () => {
  const made = new Bun.SHA256();
  made.extra = 1;
  describe("SHA256 new", made, Bun.SHA256, Bun.SHA256.prototype, undefined);
  console.log(made.extra);
});
attempt("SHA256 super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSHA256(i);
    sum += made.own();
  }
  describe("SHA256 super", made, Bun.SHA256, BelowSHA256.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowSHA256);
});
attempt("SHA256 reflected", () => {
  const made = Reflect.construct(Bun.SHA256, [], OtherSHA256);
  made.extra = 1;
  describe("SHA256 reflected", made, Bun.SHA256, OtherSHA256.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("SHA256 reflected for itself", () => {
  const made = Reflect.construct(Bun.SHA256, []);
  describe("SHA256 reflected for itself", made, Bun.SHA256, Bun.SHA256.prototype, undefined);
});

class BelowHTMLRewriter extends HTMLRewriter {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherHTMLRewriter() {}
OtherHTMLRewriter.prototype.mark = "HTMLRewriter";
attempt("HTMLRewriter new", () => {
  const made = new HTMLRewriter();
  made.extra = 1;
  describe("HTMLRewriter new", made, HTMLRewriter, HTMLRewriter.prototype, undefined);
  console.log(made.extra);
});
attempt("HTMLRewriter super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowHTMLRewriter(i);
    sum += made.own();
  }
  describe("HTMLRewriter super", made, HTMLRewriter, BelowHTMLRewriter.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowHTMLRewriter);
});
attempt("HTMLRewriter reflected", () => {
  const made = Reflect.construct(HTMLRewriter, [], OtherHTMLRewriter);
  made.extra = 1;
  describe("HTMLRewriter reflected", made, HTMLRewriter, OtherHTMLRewriter.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("HTMLRewriter reflected for itself", () => {
  const made = Reflect.construct(HTMLRewriter, []);
  describe("HTMLRewriter reflected for itself", made, HTMLRewriter, HTMLRewriter.prototype, undefined);
});

class BelowCookie extends Bun.Cookie {
  tag;
  constructor(first, second, tag) {
    super(first, second);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCookie() {}
OtherCookie.prototype.mark = "Cookie";
attempt("Cookie new", () => {
  const first = "a";
  const second = "b";
  const made = new Bun.Cookie(first, second);
  made.extra = 1;
  describe("Cookie new", made, Bun.Cookie, Bun.Cookie.prototype, first);
  console.log(made.extra);
});
attempt("Cookie super", () => {
  const first = "a";
  const second = "b";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCookie(first, second, i);
    sum += made.own();
  }
  describe("Cookie super", made, Bun.Cookie, BelowCookie.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowCookie);
});
attempt("Cookie reflected", () => {
  const first = "a";
  const second = "b";
  const made = Reflect.construct(Bun.Cookie, [first, second], OtherCookie);
  made.extra = 1;
  describe("Cookie reflected", made, Bun.Cookie, OtherCookie.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Cookie reflected for itself", () => {
  const first = "a";
  const second = "b";
  const made = Reflect.construct(Bun.Cookie, [first, second]);
  describe("Cookie reflected for itself", made, Bun.Cookie, Bun.Cookie.prototype, first);
});

class BelowCookieMap extends Bun.CookieMap {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherCookieMap() {}
OtherCookieMap.prototype.mark = "CookieMap";
attempt("CookieMap new", () => {
  const made = new Bun.CookieMap();
  made.extra = 1;
  describe("CookieMap new", made, Bun.CookieMap, Bun.CookieMap.prototype, undefined);
  console.log(made.extra);
});
attempt("CookieMap super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowCookieMap(i);
    sum += made.own();
  }
  describe("CookieMap super", made, Bun.CookieMap, BelowCookieMap.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowCookieMap);
});
attempt("CookieMap reflected", () => {
  const made = Reflect.construct(Bun.CookieMap, [], OtherCookieMap);
  made.extra = 1;
  describe("CookieMap reflected", made, Bun.CookieMap, OtherCookieMap.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("CookieMap reflected for itself", () => {
  const made = Reflect.construct(Bun.CookieMap, []);
  describe("CookieMap reflected for itself", made, Bun.CookieMap, Bun.CookieMap.prototype, undefined);
});

class BelowEventEmitter extends EventEmitter {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherEventEmitter() {}
OtherEventEmitter.prototype.mark = "EventEmitter";
attempt("EventEmitter new", () => {
  const made = new EventEmitter();
  made.extra = 1;
  describe("EventEmitter new", made, EventEmitter, EventEmitter.prototype, undefined);
  console.log(made.extra);
});
attempt("EventEmitter super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowEventEmitter(i);
    sum += made.own();
  }
  describe("EventEmitter super", made, EventEmitter, BelowEventEmitter.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowEventEmitter);
});
attempt("EventEmitter reflected", () => {
  const made = Reflect.construct(EventEmitter, [], OtherEventEmitter);
  made.extra = 1;
  describe("EventEmitter reflected", made, EventEmitter, OtherEventEmitter.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("EventEmitter reflected for itself", () => {
  const made = Reflect.construct(EventEmitter, []);
  describe("EventEmitter reflected for itself", made, EventEmitter, EventEmitter.prototype, undefined);
});

class BelowStringDecoder extends StringDecoder {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherStringDecoder() {}
OtherStringDecoder.prototype.mark = "StringDecoder";
attempt("StringDecoder new", () => {
  const made = new StringDecoder();
  made.extra = 1;
  describe("StringDecoder new", made, StringDecoder, StringDecoder.prototype, undefined);
  console.log(made.extra);
});
attempt("StringDecoder super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowStringDecoder(i);
    sum += made.own();
  }
  describe("StringDecoder super", made, StringDecoder, BelowStringDecoder.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowStringDecoder);
});
attempt("StringDecoder reflected", () => {
  const made = Reflect.construct(StringDecoder, [], OtherStringDecoder);
  made.extra = 1;
  describe("StringDecoder reflected", made, StringDecoder, OtherStringDecoder.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("StringDecoder reflected for itself", () => {
  const made = Reflect.construct(StringDecoder, []);
  describe("StringDecoder reflected for itself", made, StringDecoder, StringDecoder.prototype, undefined);
});

class BelowPerformanceObserver extends PerformanceObserver {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherPerformanceObserver() {}
OtherPerformanceObserver.prototype.mark = "PerformanceObserver";
attempt("PerformanceObserver new", () => {
  const first = () => {};
  const made = new PerformanceObserver(first);
  made.extra = 1;
  describe("PerformanceObserver new", made, PerformanceObserver, PerformanceObserver.prototype, first);
  console.log(made.extra);
});
attempt("PerformanceObserver super", () => {
  const first = () => {};
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowPerformanceObserver(first, i);
    sum += made.own();
  }
  describe("PerformanceObserver super", made, PerformanceObserver, BelowPerformanceObserver.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowPerformanceObserver);
});
attempt("PerformanceObserver reflected", () => {
  const first = () => {};
  const made = Reflect.construct(PerformanceObserver, [first], OtherPerformanceObserver);
  made.extra = 1;
  describe("PerformanceObserver reflected", made, PerformanceObserver, OtherPerformanceObserver.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("PerformanceObserver reflected for itself", () => {
  const first = () => {};
  const made = Reflect.construct(PerformanceObserver, [first]);
  describe("PerformanceObserver reflected for itself", made, PerformanceObserver, PerformanceObserver.prototype, first);
});

class BelowMessageChannel extends MessageChannel {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherMessageChannel() {}
OtherMessageChannel.prototype.mark = "MessageChannel";
attempt("MessageChannel new", () => {
  const made = new MessageChannel();
  made.extra = 1;
  describe("MessageChannel new", made, MessageChannel, MessageChannel.prototype, undefined);
  console.log(made.extra);
});
attempt("MessageChannel super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowMessageChannel(i);
    sum += made.own();
  }
  describe("MessageChannel super", made, MessageChannel, BelowMessageChannel.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowMessageChannel);
});
attempt("MessageChannel reflected", () => {
  const made = Reflect.construct(MessageChannel, [], OtherMessageChannel);
  made.extra = 1;
  describe("MessageChannel reflected", made, MessageChannel, OtherMessageChannel.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("MessageChannel reflected for itself", () => {
  const made = Reflect.construct(MessageChannel, []);
  describe("MessageChannel reflected for itself", made, MessageChannel, MessageChannel.prototype, undefined);
});

class BelowAsyncLocalStorage extends AsyncLocalStorage {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherAsyncLocalStorage() {}
OtherAsyncLocalStorage.prototype.mark = "AsyncLocalStorage";
attempt("AsyncLocalStorage new", () => {
  const made = new AsyncLocalStorage();
  made.extra = 1;
  describe("AsyncLocalStorage new", made, AsyncLocalStorage, AsyncLocalStorage.prototype, undefined);
  console.log(made.extra);
});
attempt("AsyncLocalStorage super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowAsyncLocalStorage(i);
    sum += made.own();
  }
  describe("AsyncLocalStorage super", made, AsyncLocalStorage, BelowAsyncLocalStorage.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowAsyncLocalStorage);
});
attempt("AsyncLocalStorage reflected", () => {
  const made = Reflect.construct(AsyncLocalStorage, [], OtherAsyncLocalStorage);
  made.extra = 1;
  describe("AsyncLocalStorage reflected", made, AsyncLocalStorage, OtherAsyncLocalStorage.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("AsyncLocalStorage reflected for itself", () => {
  const made = Reflect.construct(AsyncLocalStorage, []);
  describe("AsyncLocalStorage reflected for itself", made, AsyncLocalStorage, AsyncLocalStorage.prototype, undefined);
});

class BelowScript extends Script {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherScript() {}
OtherScript.prototype.mark = "Script";
attempt("Script new", () => {
  const first = "1";
  const made = new Script(first);
  made.extra = 1;
  describe("Script new", made, Script, Script.prototype, first);
  console.log(made.extra);
});
attempt("Script super", () => {
  const first = "1";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowScript(first, i);
    sum += made.own();
  }
  describe("Script super", made, Script, BelowScript.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowScript);
});
attempt("Script reflected", () => {
  const first = "1";
  const made = Reflect.construct(Script, [first], OtherScript);
  made.extra = 1;
  describe("Script reflected", made, Script, OtherScript.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Script reflected for itself", () => {
  const first = "1";
  const made = Reflect.construct(Script, [first]);
  describe("Script reflected for itself", made, Script, Script.prototype, first);
});

class BelowS3Client extends Bun.S3Client {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherS3Client() {}
OtherS3Client.prototype.mark = "S3Client";
attempt("S3Client new", () => {
  const made = new Bun.S3Client();
  made.extra = 1;
  describe("S3Client new", made, Bun.S3Client, Bun.S3Client.prototype, undefined);
  console.log(made.extra);
});
attempt("S3Client super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowS3Client(i);
    sum += made.own();
  }
  describe("S3Client super", made, Bun.S3Client, BelowS3Client.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowS3Client);
});
attempt("S3Client reflected", () => {
  const made = Reflect.construct(Bun.S3Client, [], OtherS3Client);
  made.extra = 1;
  describe("S3Client reflected", made, Bun.S3Client, OtherS3Client.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("S3Client reflected for itself", () => {
  const made = Reflect.construct(Bun.S3Client, []);
  describe("S3Client reflected for itself", made, Bun.S3Client, Bun.S3Client.prototype, undefined);
});

class BelowSemver extends Bun.Archive {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSemver() {}
OtherSemver.prototype.mark = "Semver";
attempt("Semver new", () => {
  const first = {};
  const made = new Bun.Archive(first);
  made.extra = 1;
  describe("Semver new", made, Bun.Archive, Bun.Archive.prototype, first);
  console.log(made.extra);
});
attempt("Semver super", () => {
  const first = {};
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSemver(first, i);
    sum += made.own();
  }
  describe("Semver super", made, Bun.Archive, BelowSemver.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowSemver);
});
attempt("Semver reflected", () => {
  const first = {};
  const made = Reflect.construct(Bun.Archive, [first], OtherSemver);
  made.extra = 1;
  describe("Semver reflected", made, Bun.Archive, OtherSemver.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Semver reflected for itself", () => {
  const first = {};
  const made = Reflect.construct(Bun.Archive, [first]);
  describe("Semver reflected for itself", made, Bun.Archive, Bun.Archive.prototype, first);
});
setTimeout(() => process.exit(0), 50);

// GENERATED: attempt OtherBuffer BelowResponse
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="throws"
// CHECK-NEXT: v10 = PropGet v3 key="constructor"
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Call v8, v6, v0, v9, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="OtherBuffer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="BelowResponse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_2]]|ArrayBuffer|Blob|ReadableStream|TypedArray|URLSearchParams flags=[IsExpected]}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string|[[L_2]]|ArrayBuffer|Blob|ReadableStream|TypedArray|URLSearchParams, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_4]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v15, v3 key="tag"
// CHECK-NEXT: v17 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="late"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v21, v23 key="late"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: v26 = TypeTest v25 testedType=object
// CHECK-NEXT: Branch v26 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: Jump -> next b12(v27)
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: v29 = TypeTest v28 testedType=undefined
// CHECK-NEXT: Branch v29 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = TypeTest v20 testedType=absent
// CHECK-NEXT: Branch v31 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v32) frequency=Unlikely:
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v33
// CHECK-NEXT: b11(v34):
// CHECK-NEXT: Jump -> next b12(v34)
// CHECK-NEXT: b12(v35):
// CHECK-NEXT: Return v35
// CHECK-NEXT: b13(v36) frequency=Unlikely:
// CHECK-NEXT: v37 = NewRuntimeError runtimeError=DerivedConstructorResult name="BelowResponse"
// CHECK-NEXT: Throw v37
// CHECK-NEXT: b14(v38) frequency=Unlikely:
// CHECK-NEXT: v39 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v39
// CHECK-NEXT: }
