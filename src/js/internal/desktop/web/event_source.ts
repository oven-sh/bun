const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const network = require("internal/desktop/web/fetch");
const { MessageEvent } = require("internal/desktop/web/messaging");

const { scope } = idl;

const isTransient = /^ERR_(?:CONNECTION|NAME_NOT|INTERNET|TIMED|PROXY|EMPTY|NETWORK)/;

class EventSource extends idl.EventTarget {
  #url: string;
  #withCredentials: boolean;
  #state = 0;
  #load: { abort(): void } | undefined;
  #timer: Timer | undefined;
  #lastId = "";
  #retry = 3000;
  #stop = () => this.close();

  constructor(url: string, init: any = undefined) {
    idl.need(arguments.length, 1);
    url = idl.usv(url);
    const { withCredentials } = idl.dictionary(init);
    const parsed = idl.parseUrl(url, true);
    if (!parsed) throw idl.error("SyntaxError", `Cannot open an EventSource to '${url}'. The URL is invalid.`);
    super();
    this.#url = parsed.href;
    this.#withCredentials = !!withCredentials;
    scope.cleanups.add(this.#stop);
    this.#connect();
  }

  get url() {
    return this.#url;
  }

  get withCredentials() {
    return this.#withCredentials;
  }

  get readyState() {
    return this.#state;
  }

  close() {
    this.#state = 2;
    this.#load?.abort();
    clearTimeout(this.#timer);
    scope.cleanups.delete(this.#stop);
  }

  #fail() {
    if (this.#state === 2) return;
    this.close();
    idl.fire(this, "error");
  }

  #reconnect() {
    if (this.#state === 2) return;
    this.#state = 0;
    idl.fire(this, "error");
    if (this.#state === 0) this.#timer = setTimeout(() => this.#connect(), Math.min(this.#retry, 2 ** 31 - 1));
  }

  #connect() {
    const options = new network.Options();
    const headers = new network.HeaderList([
      ["Accept", "text/event-stream"],
      ["Cache-Control", "no-cache"],
    ]);
    if (this.#lastId !== "") headers.append("Last-Event-ID", Buffer.from(this.#lastId).latin1Slice());
    options.url = this.#url;
    options.credentials = this.#withCredentials ? "include" : "same-origin";
    options.cache = "no-store";
    options.initiator = "other";
    const load = (this.#load = scope.env.load({ ...options, headers: [], trustedHeaders: headers.pairs, body: null }));
    load.promise.then(
      (loaded: any) => idl.runTask(() => this.#open(loaded)),
      (failure: any) => idl.runTask(() => (!isTransient.test(failure.code) ? this.#fail() : this.#reconnect())),
    );
  }

  #open({ status, headers, url, reader }: any) {
    if (this.#state === 2) return;
    const type = mime.extract(new network.HeaderList(headers).get("content-type"));
    if (status !== 200 || type?.essence !== "text/event-stream") return this.#fail();
    this.#state = 1;
    this.#url = url;
    idl.fire(this, "open");
    const { origin } = new URL(url);
    const decoder = new TextDecoder();
    let rest = "";
    let data = "";
    let name = "";
    let id = this.#lastId;
    let skipsNewline = false;
    const take = (line: string) => {
      if (line === "") {
        this.#lastId = id;
        const event = data && new MessageEvent(name || "message", { data: data.slice(0, -1), origin, lastEventId: id });
        data = name = "";
        if (event) idl.queueTask(() => this.#state !== 2 && idl.dispatchInTask(this, event));
        return;
      }
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + (line[colon + 1] === " " ? 2 : 1));
      if (field === "data") data += value + "\n";
      else if (field === "event") name = value;
      else if (field === "id" && !value.includes("\0")) id = value;
      else if (field === "retry" && /^\d+$/.test(value)) this.#retry = +value;
    };
    const ended = () => idl.queueTask(() => this.#reconnect());
    const read = () =>
      reader.read().then(({ done, value }: any) => {
        if (done) return ended();
        let text = decoder.decode(value, { stream: true });
        if (text !== "") {
          if (skipsNewline && text[0] === "\n") text = text.slice(1);
          skipsNewline = text.endsWith("\r");
        }
        const lines = (rest + text).split(/\r\n|\r|\n/);
        rest = lines.pop()!;
        lines.forEach(take);
        read();
      }, ended);
    if (reader) read();
    else ended();
  }
}
idl.defineHandlers(EventSource.prototype, ["open", "message", "error"]);
idl.expose(EventSource, ["CONNECTING", "OPEN", "CLOSED"]);

export default { EventSource };
