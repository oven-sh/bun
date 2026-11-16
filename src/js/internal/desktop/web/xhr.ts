const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const { ProgressEvent } = require("internal/desktop/web/dom").events;
const network = require("internal/desktop/web/fetch");

const { EventTarget, byteString, error, expose, internal, need, scope, usv } = idl;
const { HeaderList, Options } = network;

const enum State {
  Unsent,
  Opened,
  HeadersReceived,
  Loading,
  Done,
}

function progress(target: object, type: string, loaded = 0, total = 0) {
  if (idl.hasListeners(target, type)) {
    idl.dispatch(target, new ProgressEvent(type, { loaded, total, lengthComputable: total !== 0 }));
  }
}

const progressTypes = ["loadstart", "progress", "abort", "error", "load", "timeout", "loadend"];

class XMLHttpRequestEventTarget extends EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
}
idl.defineHandlers(XMLHttpRequestEventTarget.prototype, progressTypes);
expose(XMLHttpRequestEventTarget);

class XMLHttpRequestUpload extends XMLHttpRequestEventTarget {}
expose(XMLHttpRequestUpload);

const invalidState = (message: string) => error("InvalidStateError", message);
const isDocument = (value: unknown) =>
  scope.isWindow && require("internal/desktop/web/dom").core.nodeOf(value)?.type === 9;

const markupOf = (node: any) => (node.nodeType === 10 ? `<!DOCTYPE ${node.name}>` : `<!--${node.data}-->`);

class XMLHttpRequest extends XMLHttpRequestEventTarget {
  #upload: XMLHttpRequestUpload | undefined;
  #state = State.Unsent;
  #isSent = false;
  #isSynchronous = false;
  #isUploaded = false;
  #tellsUpload = false;
  #withCredentials = false;
  #timeout = 0;
  #timer: Timer | undefined;
  #sentAt = 0;
  #options = new Options();
  #login: [string, string] | undefined;
  #headers = new HeaderList();
  #responseType = "";
  #overriddenType: any;
  #load: { abort(): void } | undefined;
  /** Undefined for a network error. */
  #response: any;
  #responseHeaders = new HeaderList();
  #chunks: Uint8Array[] = [];
  #text: string | undefined;
  #value: unknown;

  constructor() {
    super(internal);
  }

  get readyState() {
    return this.#state;
  }

  #setState(state: State) {
    this.#state = state;
    if (idl.hasListeners(this, "readystatechange")) idl.dispatch(this, new idl.Event("readystatechange"));
  }

  #terminate() {
    this.#load?.abort();
    this.#load = undefined;
    clearTimeout(this.#timer);
  }

  #forgetResponse() {
    this.#response = this.#text = this.#value = undefined;
    this.#responseHeaders = new HeaderList();
    this.#chunks = [];
  }

  open(method: string, url: string, ...rest: unknown[]) {
    this.#state;
    need(arguments.length, 2);
    method = byteString(method);
    url = usv(url);
    const isSynchronous = rest.length > 0 && !rest[0];
    const [user, password] = [rest[1], rest[2]].map(it => (it == null ? null : usv(it)));
    if (scope.disposed) throw invalidState("The document is not active.");
    if (!mime.isToken(method)) throw error("SyntaxError", `'${method}' is not a valid HTTP method.`);
    if (mime.isForbiddenMethod(method)) throw error("SecurityError", `'${method}' HTTP method is unsupported.`);
    const parsed = idl.parseUrl(url, true);
    if (!parsed) throw error("SyntaxError", "Invalid URL");
    if (isSynchronous && scope.isWindow && (this.#timeout !== 0 || this.#responseType !== "")) {
      throw error("InvalidAccessError", "A synchronous request of a document has no timeout and no response type.");
    }
    this.#terminate();
    this.#isSent = this.#tellsUpload = false;
    this.#isSynchronous = isSynchronous;
    const options = (this.#options = new Options());
    options.method = mime.normalizeMethod(method);
    options.initiator = "xmlhttprequest";
    if (user !== null) parsed.username = user;
    if (password !== null) parsed.password = password;
    options.url = parsed.href;
    if (parsed.protocol === "blob:") options.blob = scope.env.resolveBlob(parsed.href);
    this.#headers = new HeaderList();
    this.#forgetResponse();
    if (this.#state !== State.Opened) this.#setState(State.Opened);
  }

  #requireOpened() {
    if (this.#state !== State.Opened || this.#isSent) throw invalidState("The object's state must be OPENED.");
  }

  setRequestHeader(name: string, value: string) {
    this.#state;
    need(arguments.length, 2);
    name = byteString(name);
    value = mime.trim(byteString(value));
    this.#requireOpened();
    if (!mime.isToken(name) || /[\0\n\r]/.test(value)) throw error("SyntaxError", `'${name}' is not a valid header.`);
    const lower = name.toLowerCase();
    if (mime.isForbiddenHeader(lower, value)) return;
    const before = this.#headers.get(lower);
    this.#headers.set(name, before === null ? value : before + ", " + value);
  }

  get timeout() {
    return this.#timeout;
  }

  set timeout(value) {
    value >>>= 0;
    if (this.#isSynchronous && scope.isWindow && this.#state !== State.Unsent) {
      throw error("InvalidAccessError", "A synchronous request of a document has no timeout.");
    }
    this.#timeout = value;
    if (this.#load) this.#startTimer();
  }

  #startTimer() {
    clearTimeout(this.#timer);
    if (this.#timeout === 0) return;
    const left = Math.max(this.#sentAt + this.#timeout - performance.now(), 0);
    this.#timer = setTimeout(idl.runTask, Math.min(left, 2 ** 31 - 1), () => this.#fail("timeout"));
  }

  get withCredentials() {
    return this.#withCredentials;
  }

  set withCredentials(value) {
    if (this.#state > State.Opened || this.#isSent) throw invalidState("The request has been sent.");
    this.#withCredentials = !!value;
  }

  get upload() {
    return (this.#upload ??= new XMLHttpRequestUpload(internal));
  }

  #extract(body: any) {
    const headers = this.#headers;
    const given = headers.get("content-type");
    let type: string | null;
    let extracted;
    const isText = isDocument(body);
    if (isText) {
      const isHtml = body.contentType === "text/html";
      const text = isHtml
        ? Array.from(body.childNodes, (node: any) => node.outerHTML ?? markupOf(node)).join("")
        : new scope.global.XMLSerializer().serializeToString(body);
      [extracted] = network.extractBody(text);
      type = isHtml ? "text/html;charset=UTF-8" : "application/xml;charset=UTF-8";
    } else [extracted, type] = network.extractBody(network.isStream(body) ? `${body}` : body);
    if (given === null) {
      if (type !== null) headers.set("Content-Type", type);
    } else if (isText || type === "text/plain;charset=UTF-8" || idl.isBranded(URLSearchParams, "toString", body)) {
      const parsed = mime.parse(given);
      const charset = parsed?.parameters.get("charset");
      if (!$inheritsBlob(body) && charset !== undefined && charset.toLowerCase() !== "utf-8") {
        parsed!.parameters.set("charset", "UTF-8");
        headers.set("Content-Type", mime.serialize(parsed!));
      }
    }
    return extracted;
  }

  send(body: any = null) {
    const options = this.#options;
    if ($isObject(body)) idl.bytesOf(body);
    this.#requireOpened();
    const extracted = body === null || /^(?:GET|HEAD)$/.test(options.method) ? null : this.#extract(body);
    this.#requireOpened();
    const upload = this.#upload;
    this.#tellsUpload = upload !== undefined && progressTypes.some(type => idl.hasListeners(upload, type));
    options.credentials = this.#withCredentials ? "include" : "same-origin";
    options.usesPreflight = this.#tellsUpload;
    this.#isUploaded = extracted === null;
    this.#isSent = true;
    const source = extracted?.source ?? null;
    if (this.#isSynchronous) return this.#sendSynchronously(source);

    const length = extracted?.length ?? 0;
    progress(this, "loadstart");
    if (!this.#isUploaded && this.#tellsUpload) progress(upload!, "loadstart", 0, length);
    if (this.#state !== State.Opened || !this.#isSent || this.#options !== options) return;
    let lastUpload = performance.now();
    const uploaded = (sent: number) => {
      if (sent === length || performance.now() - lastUpload < 50) return;
      lastUpload = performance.now();
      idl.queueTask(() => this.#load === load && !this.#isUploaded && progress(upload!, "progress", sent, length));
    };
    const load = (this.#load = network.start(
      options,
      this.#headers,
      source,
      0,
      this.#tellsUpload && scope.isWindow ? uploaded : undefined,
    ));
    this.#sentAt = performance.now();
    this.#startTimer();
    const step = (run: (value: any) => void) => (value: unknown) => this.#load === load && idl.runTask(run, value);
    const failed = step(() => this.#fail("error"));
    let received = 0;
    let lastProgress = -Infinity;
    let told = 0;
    const read = (reader: any, total: number) =>
      reader.read().then(
        step(({ done, value }) => {
          if (done) return this.#finish(received, total, told);
          this.#chunks.push(value);
          this.#text = undefined;
          received += value.byteLength;
          if (value.byteLength > 0 && performance.now() - lastProgress >= 50) {
            lastProgress = performance.now();
            told = received;
            this.#setState(State.Loading);
            if (this.#load === load) progress(this, "progress", received, total);
          }
          if (this.#load === load) read(reader, total);
        }),
        failed,
      );
    load.promise.then(
      step(loaded => {
        if (!this.#isUploaded) {
          this.#isUploaded = true;
          for (const type of this.#tellsUpload ? ["progress", "load", "loadend"] : [])
            progress(upload!, type, length, length);
          if (this.#load !== load) return;
        }
        this.#accept(loaded);
        this.#setState(State.HeadersReceived);
        if (this.#load !== load) return;
        if (loaded.reader) read(loaded.reader, this.#expectedLength());
        else this.#finish(0, 0);
      }),
      failed,
    );
  }

  #accept(loaded: any) {
    this.#response = loaded;
    this.#responseHeaders = new HeaderList(loaded.headers);
  }

  #expectedLength() {
    const headers = this.#responseHeaders;
    return headers.get("content-encoding") === null ? +headers.get("content-length")! || 0 : 0;
  }

  #sendSynchronously(body: unknown) {
    const loaded = scope.env.loadSync({ ...this.#options, headers: this.#headers.pairs, body }, this.#timeout);
    if (loaded.failure !== undefined) return this.#fail(loaded.failure);
    this.#accept(loaded);
    this.#chunks = [loaded.bytes];
    this.#finish(loaded.bytes.byteLength, this.#expectedLength());
  }

  #finish(received: number, total: number, told = 0) {
    const load = this.#load;
    if (!this.#isSynchronous && received > told) progress(this, "progress", received, total);
    if (this.#load !== load) return;
    this.#load = this.#text = undefined;
    clearTimeout(this.#timer);
    this.#isSent = false;
    const response = this.#response;
    this.#setState(State.Done);
    if (this.#response !== response) return;
    progress(this, "load", received, total);
    progress(this, "loadend", received, total);
  }

  #fail(type: string) {
    this.#terminate();
    this.#state = State.Done;
    this.#isSent = false;
    this.#forgetResponse();
    if (this.#isSynchronous) {
      throw error(type === "timeout" ? "TimeoutError" : "NetworkError", `Failed to load '${this.#options.url}'.`);
    }
    this.#setState(State.Done);
    if (!this.#isUploaded) {
      this.#isUploaded = true;
      for (const name of this.#tellsUpload ? [type, "loadend"] : []) progress(this.#upload!, name);
    }
    progress(this, type);
    progress(this, "loadend");
  }

  abort() {
    this.#terminate();
    const state = this.#state;
    if ((state === State.Opened && this.#isSent) || state === State.HeadersReceived || state === State.Loading) {
      this.#fail("abort");
    }
    if (this.#state !== State.Done) return;
    this.#state = State.Unsent;
    this.#forgetResponse();
  }

  get responseURL() {
    return this.#response?.url.split("#")[0] ?? "";
  }

  get status() {
    return this.#response?.status ?? 0;
  }

  get statusText() {
    return this.#response?.statusText ?? "";
  }

  getResponseHeader(name: string) {
    const headers = this.#responseHeaders;
    need(arguments.length, 1);
    return headers.get(byteString(name).toLowerCase());
  }

  getAllResponseHeaders() {
    const upper = (pair: string[]) => pair[0].toUpperCase();
    return this.#responseHeaders
      .sorted()
      .toSorted((a, b) => (upper(a) < upper(b) ? -1 : 1))
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");
  }

  overrideMimeType(type: string) {
    const state = this.#state;
    need(arguments.length, 1);
    type = `${type}`;
    if (state >= State.Loading)
      throw invalidState("The MIME type cannot be overridden when the state is LOADING or DONE.");
    this.#overriddenType = mime.parse(type) ?? mime.parse("application/octet-stream");
  }

  get responseType() {
    return this.#responseType;
  }

  set responseType(value) {
    const state = this.#state;
    value = `${value}`;
    if (!["", "arraybuffer", "blob", "document", "json", "text"].includes(value)) return;
    if (value === "document" && !scope.isWindow) return;
    if (state >= State.Loading) throw invalidState("The type cannot be set when the state is LOADING or DONE.");
    if (this.#isSynchronous && scope.isWindow && state !== State.Unsent) {
      throw error("InvalidAccessError", "A synchronous request of a document has no response type.");
    }
    this.#responseType = value;
  }

  #receivedType() {
    return mime.extract(this.#responseHeaders.get("content-type")) ?? mime.parse("text/xml")!;
  }

  #finalEncoding() {
    const label = this.#overriddenType?.parameters.get("charset") ?? this.#receivedType().parameters.get("charset");
    return mime.encodingOf(label);
  }

  #bytes() {
    const bytes = network.concatenate(this.#chunks);
    this.#chunks = [bytes];
    return bytes;
  }

  #decodeText() {
    if (this.#state < State.Loading || !this.#response) return "";
    if (this.#text !== undefined) return this.#text;
    const bytes = this.#bytes();
    let encoding = this.#finalEncoding();
    if (!encoding && this.#responseType === "" && mime.isXml((this.#overriddenType ?? this.#receivedType()).essence)) {
      encoding = mime.declaredInXml(bytes);
    }
    return (this.#text = mime.decode(bytes, encoding, this.#state !== State.Done));
  }

  #parseDocument() {
    const { essence } = this.#overriddenType ?? this.#receivedType();
    const isHtml = essence === "text/html";
    const bytes = this.#bytes();
    if (bytes.length === 0 || (isHtml ? this.#responseType === "" : !mime.isXml(essence))) return null;
    const encoding =
      mime.sniffBom(bytes) ??
      this.#finalEncoding() ??
      (isHtml ? mime.prescan(bytes) : mime.declaredInXml(bytes)) ??
      "utf-8";
    return require("internal/desktop/web/dom").document.parseResponse(mime.decode(bytes, encoding), {
      isHtml,
      contentType: essence,
      encoding,
      url: this.#response.url,
      lastModified: this.#responseHeaders.get("last-modified"),
    });
  }

  #convert() {
    switch (this.#responseType) {
      case "arraybuffer":
        return new Uint8Array(this.#bytes()).buffer;
      case "blob": {
        const type = mime.serialize(this.#overriddenType ?? this.#receivedType());
        return require("internal/desktop/web/files").blobOfType([this.#bytes()], type);
      }
      case "json":
        try {
          return JSON.parse(new TextDecoder().decode(this.#bytes()));
        } catch {
          return null;
        }
    }
    return this.#parseDocument();
  }

  #object() {
    if (this.#state !== State.Done || !this.#response) return null;
    if (this.#value === undefined) this.#value = this.#convert();
    return this.#value;
  }

  get response() {
    return this.#responseType === "" || this.#responseType === "text" ? this.#decodeText() : this.#object();
  }

  get responseText() {
    if (this.#responseType !== "" && this.#responseType !== "text") {
      throw invalidState("The value is only accessible if the object's 'responseType' is '' or 'text'.");
    }
    return this.#decodeText();
  }

  get responseXML() {
    if (this.#responseType !== "" && this.#responseType !== "document") {
      throw invalidState("The value is only accessible if the object's 'responseType' is '' or 'document'.");
    }
    return this.#object();
  }
}
idl.defineHandlers(XMLHttpRequest.prototype, ["readystatechange"]);
expose(XMLHttpRequest, ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"]);
if (!scope.isWindow) delete (XMLHttpRequest.prototype as any).responseXML;

export default { XMLHttpRequest, XMLHttpRequestEventTarget, XMLHttpRequestUpload };
