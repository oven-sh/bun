const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const { messageEvent } = require("internal/desktop/web/messaging");

const { error, scope, usv } = idl;

const CloseEvent = idl.eventClass("CloseEvent", {
  wasClean: [Boolean, false],
  code: [value => value & 0xffff, 0],
  reason: [usv, ""],
});

function socketUrl(given: string) {
  const url = idl.parseUrl(given);
  if (!url) throw error("SyntaxError", `The URL '${given}' is invalid.`);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw error("SyntaxError", "The URL's scheme must be either 'http', 'https', 'ws', or 'wss'.");
  }
  if (url.href.includes("#")) throw error("SyntaxError", "The URL of a WebSocket cannot have a fragment.");
  return url;
}

class WebSocket extends idl.EventTarget {
  #url: URL;
  #native: any;
  #state = 0;
  #binaryType = "blob";
  #buffered = 0;
  #sentInTask = 0;
  #sending: Promise<unknown> | undefined;
  #stop = () => this.#native?.close(1001);

  constructor(url: string, protocols: any = []) {
    idl.need(arguments.length, 1);
    url = usv(url);
    const isList = $isObject(protocols) && protocols[Symbol.iterator] != null;
    const list: string[] = isList ? idl.sequence(protocols).map(idl.string) : [`${protocols}`];
    const parsed = socketUrl(url);
    if (!list.every(mime.isToken) || new Set(list.map(it => it.toLowerCase())).size !== list.length) {
      throw error("SyntaxError", "The subprotocols have to be distinct tokens.");
    }
    super();
    this.#url = parsed;
    const allowed = scope.env.webSocket(parsed.href);
    if (allowed.refusal === "mixed") {
      throw error("SecurityError", "An insecure WebSocket may not be opened from a page loaded over HTTPS.");
    }
    if (allowed.refusal) {
      this.#state = 3;
      idl.queueTask(() => this.#closed(false, 1006, ""));
      return;
    }
    this.#url = new URL(allowed.url);
    const failed = () => idl.runTask(() => this.#closed(false, 1006, ""));
    scope.env.socketOptions(allowed.url, allowed.headers).then(({ proxy, tls, headers }: any) => {
      if (this.#state !== 0 || scope.disposed) return failed();
      const options = { protocols: list, headers: { ...headers }, proxy, tls };
      const native = (this.#native = new idl.native.WebSocket(allowed.url, options as any));
      native.binaryType = "arraybuffer";
      native.onopen = () => idl.runTask(() => this.#opened());
      native.onmessage = ({ data }) => idl.runTask(() => this.#received(data));
      native.onclose = ({ wasClean, code, reason }) => idl.runTask(() => this.#closed(wasClean, code, reason));
      scope.cleanups.add(this.#stop);
    }, failed);
  }

  #opened() {
    if (this.#state !== 0) return;
    this.#state = 1;
    idl.fire(this, "open");
  }

  #received(data: unknown) {
    if (this.#state !== 1) return;
    if (typeof data !== "string" && this.#binaryType === "blob") data = new Blob([data as any]);
    idl.dispatchInTask(this, messageEvent("message", data, this.#url.origin, null, []));
  }

  #closed(wasClean: boolean, code: number, reason: string) {
    this.#state = 3;
    scope.cleanups.delete(this.#stop);
    if (!wasClean) idl.fire(this, "error");
    const init = wasClean ? { wasClean, code, reason } : { code: 1006 };
    idl.dispatchInTask(this, new CloseEvent("close", init));
  }

  get url() {
    return this.#url.href;
  }
  get readyState() {
    return this.#state;
  }
  get bufferedAmount() {
    return this.#buffered + (this.#sentInTask === 0 ? (this.#native?.bufferedAmount ?? 0) : 0);
  }
  get extensions() {
    return this.#native?.extensions ?? "";
  }
  get protocol() {
    return this.#native?.protocol ?? "";
  }
  get binaryType() {
    return this.#binaryType;
  }
  set binaryType(value) {
    this.#state;
    value = `${value}`;
    if (value === "blob" || value === "arraybuffer") this.#binaryType = value;
  }

  /** After the blobs that are still being read. */
  #inOrder(run: () => unknown) {
    const sending = (this.#sending = (this.#sending ?? Promise.$resolve()).then(run).finally(() => {
      if (this.#sending === sending) this.#sending = undefined;
    }));
  }

  close(code: any = undefined, reason: any = undefined) {
    this.#state;
    if (code !== undefined) {
      const clamped = Math.min(Math.max(+code || 0, 0), 0xffff);
      code = Math.round(clamped) - (clamped % 2 === 0.5 ? 1 : 0);
      if (code !== 1000 && (code < 3000 || code > 4999)) {
        throw error("InvalidAccessError", "The close code must be either 1000, or between 3000 and 4999.");
      }
    }
    if (reason !== undefined && Buffer.byteLength((reason = usv(reason))) > 123) {
      throw error("SyntaxError", "The close reason must not be greater than 123 UTF-8 bytes.");
    }
    if (this.#state >= 2) return;
    this.#state = 2;
    const close = () => this.#native?.close(code ?? (reason === undefined ? undefined : 1000), reason);
    if (this.#sending) this.#inOrder(close);
    else close();
  }

  send(data: any) {
    this.#state;
    idl.need(arguments.length, 1);
    const isBlob = $inheritsBlob(data);
    if (!isBlob) data = ($isObject(data) && idl.bytesOf(data)) || usv(data);
    if (this.#state === 0) throw error("InvalidStateError", "Still in CONNECTING state.");
    const length = isBlob ? data.size : Buffer.byteLength(data);
    this.#buffered += length;
    if (this.#state !== 1) return;
    if (this.#sentInTask === 0) {
      idl.queueTask(() => {
        this.#buffered -= this.#sentInTask;
        this.#sentInTask = 0;
      });
    }
    this.#sentInTask += length;
    if (isBlob) this.#inOrder(async () => this.#native.send(await data.bytes()));
    else if (!this.#sending) this.#native.send(data);
    else {
      const copy = typeof data === "string" ? data : data.slice();
      this.#inOrder(() => this.#native.send(copy));
    }
  }
}
idl.defineHandlers(WebSocket.prototype, ["open", "error", "close", "message"]);
idl.expose(WebSocket, ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]);

export default { CloseEvent, WebSocket };
