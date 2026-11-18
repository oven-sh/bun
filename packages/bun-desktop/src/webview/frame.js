// The preload script of the document that stands in for the page around an `<iframe>`. `wire` is above.
const { ipcRenderer } = require("electron");
const CHANNEL = "bun:desktop:frame";
const MIDDLE = 50000;

if (window === top) {
  const ports = new Map();
  let nextPort = 1;
  let frame;
  let isEntering = false;
  /** In place of the frame. */
  let popup;
  const root = () => popup ?? frame.contentWindow;
  let sent = Promise.resolve();

  /** Blobs are read asynchronously, and the messages stay in order. */
  function send(...message) {
    sent = sent
      .then(async () => {
        const blobs = new Map();
        wire.encode(message, it => (it instanceof Blob ? void blobs.set(it) || 0 : undefined));
        for (const blob of blobs.keys()) {
          blobs.set(blob, [await blob.arrayBuffer(), blob.type, blob.name, blob.lastModified]);
        }
        ipcRenderer.send(
          CHANNEL,
          wire.encode(message, it => blobs.get(it)),
        );
      })
      .catch(() => {});
  }
  const toBlob = ([bytes, type, name, lastModified]) =>
    name === undefined ? new Blob([bytes], { type }) : new File([bytes], name, { type, lastModified });

  function carry(id, port) {
    ports.set(id, port);
    port.onmessage = event => post(id, event.data, event.ports);
    port.onclose = () => ports.delete(id) && send("packet", [id]);
  }

  function post(target, data, moved) {
    const ids = moved.map(() => (nextPort += 2));
    send("packet", [target, data, ids]);
    moved.forEach((port, index) => carry(ids[index], port));
  }

  /** The indices that lead to a window through `frames`. */
  function pathTo(source) {
    const path = [];
    for (let at = source; at !== root(); at = at.parent) {
      if (!at || at === at.parent) return;
      path.unshift(Array.prototype.indexOf.call(at.parent, at));
    }
    return path;
  }
  const windowAt = path => path.reduce((at, index) => at?.[index], root());

  const commands = {
    navigate({ src, srcdoc, ...rest }, blob) {
      for (const [name, value] of Object.entries(rest)) commands.attribute(name, value ?? null);
      if (srcdoc !== undefined) frame.srcdoc = srcdoc;
      else {
        frame.src = blob ? URL.createObjectURL(blob) : src;
        frame.removeAttribute("srcdoc");
      }
      if (!frame.isConnected) document.body.firstChild.after(frame);
    },
    open: (url, name) => (popup = open(url, name)),
    attribute: (name, value) => (value === null ? frame.removeAttribute(name) : frame.setAttribute(name, value)),
    style: style => Object.assign(frame.style, style),
    location(path, method, url) {
      if (method === "replace") windowAt(path)?.location.replace(url);
      else if (windowAt(path)) windowAt(path).location.href = url;
    },
    exitFullscreen: () => document.fullscreenElement && document.exitFullscreen(),
    focus(direction) {
      if (!direction) return frame.contentWindow.focus();
      isEntering = true;
      document.body[direction > 0 ? "firstChild" : "lastChild"].focus();
      isEntering = false;
      send("entered", direction);
    },
    packet([target, data, ids]) {
      const port = ports.get(target);
      if (!ids) return void (ports.delete(target) && port.close());
      const moved = ids.map(id => {
        const { port1, port2 } = new MessageChannel();
        carry(id, port1);
        return port2;
      });
      if (target === 0) windowAt(data.path)?.postMessage(data.message, data.targetOrigin, moved);
      else port?.postMessage(data, moved);
    },
  };

  addEventListener("message", ({ data, origin, source, ports }) => {
    const path = pathTo(source);
    if (path) post(0, { message: data, origin, path }, ports);
  });
  addEventListener("DOMContentLoaded", () => {
    frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
    frame.onload = () => send("load", frame.contentWindow.length);
    Object.assign(document.documentElement.style, { scrollbarWidth: "none", overflowAnchor: "none" });
    Object.assign(document.body.style, { margin: 0, width: `${2 * MIDDLE}px`, height: `${2 * MIDDLE}px` });
    for (const direction of [-1, 1]) {
      const stop = document.body.appendChild(document.createElement("div"));
      stop.tabIndex = 0;
      stop.style.position = "fixed";
      stop.onfocus = () => isEntering || send("tab", direction);
    }
    scrollTo(MIDDLE, MIDDLE);
    let told = [MIDDLE, MIDDLE];
    addEventListener("scroll", () => {
      if (scrollX !== told[0] || scrollY !== told[1]) send("scroll", scrollX - told[0], scrollY - told[1]);
      told = [scrollX, scrollY];
    });
    addEventListener("scrollend", () => scrollTo(...(told = [MIDDLE, MIDDLE])));
    ipcRenderer.on(CHANNEL, (_, bytes) => {
      const [name, ...args] = wire.decode(bytes.subarray(4), toBlob);
      commands[name](...args);
    });
    send("ready");
  });
}
