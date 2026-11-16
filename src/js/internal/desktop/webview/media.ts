// The page of the web engine that has the microphone, the speakers and the decoders. See `web/audio`.
const engines = require("internal/desktop/webview/engine");

const AGENT = `
const toText = ({ buffer, byteOffset, byteLength }) => new Uint8Array(buffer, byteOffset, byteLength).toBase64();
const channelsOf = buffer => Array.from({ length: buffer.numberOfChannels }, (_, i) => toText(buffer.getChannelData(i)));
const describe = track => ({ label: track.label, muted: track.muted, settings: track.getSettings(), capabilities: track.getCapabilities() });
const LEAD = 0.04;
const ofElements = "abort canplay canplaythrough durationchange emptied ended error loadeddata loadedmetadata pause play playing ratechange resize seeked seeking timeupdate waiting";

class Client {
  objects = new Map();
  offsets = new Map();
  watched = new Map();
  queue = Promise.resolve();
  constructor(id) { this.tell = (...message) => send(id + " " + JSON.stringify(message)); }
  value = it => {
    if (Array.isArray(it)) return it.map(this.value);
    if (it === null || typeof it !== "object") return it;
    if ("ref" in it) return it.param ? this.objects.get(it.ref)[it.param] : this.objects.get(it.ref);
    if ("time" in it) return Math.max(0, it.time + this.offsets.get(it.of));
    if ("floats" in it) return new Float32Array(Uint8Array.fromBase64(it.floats).buffer);
    if ("bytes" in it) return Uint8Array.fromBase64(it.bytes).buffer;
    return Object.fromEntries(Object.entries(it).map(([key, value]) => [key, this.value(value)]));
  };
  async context(id, options, now) {
    const context = new AudioContext(options);
    this.objects.set(id, context);
    await Promise.race([context.resume(), new Promise(done => setTimeout(done, 2000))]);
    const offset = context.currentTime + LEAD - now;
    this.offsets.set(id, offset);
    const report = () => this.tell(id, "clock", context.currentTime + LEAD - offset, context.baseLatency, context.outputLatency + LEAD);
    context.timer = setInterval(report, 250);
    report();
  }
  node(id, context, type, options) {
    context = this.objects.get(context);
    const node = type === "AudioDestinationNode" ? context.destination
      : type === "ScriptProcessorNode" ? context.createScriptProcessor(...options) : new globalThis[type](context, options);
    this.objects.set(id, node);
    if ("onended" in node) node.onended = () => this.tell(id, "ended");
    if ("onaudioprocess" in node) node.onaudioprocess = event => this.tell(id, "process", channelsOf(event.inputBuffer));
  }
  buffer(id, sampleRate, channels) {
    const buffer = new AudioBuffer({ sampleRate, numberOfChannels: channels.length, length: channels[0].length });
    channels.forEach((it, i) => buffer.copyToChannel(it, i));
    this.objects.set(id, buffer);
  }
  stream(id, tracks) { this.objects.set(id, new MediaStream(tracks)); }
  trackOf(id, node) { this.objects.set(id, node.stream.getAudioTracks()[0]); }
  clone(id, track) { this.keep(id, track.clone()); }
  keep(id, track) {
    this.objects.set(id, track);
    for (const type of ["ended", "mute", "unmute"]) track.addEventListener(type, () => this.tell(id, type));
  }
  element(id, name) {
    const it = Object.assign(document.createElement(name), { preload: "auto" });
    this.objects.set(id, it);
    const state = ({ type }) => this.tell(id, type, it.currentTime, String(it.duration), it.readyState, it.error?.code, it.videoWidth, it.videoHeight);
    for (const type of ofElements.split(" ")) it.addEventListener(type, state);
  }
  part(id, bytes) { (this.objects.get(id).parts ??= []).push(new Blob([bytes])); }
  source(id, type) {
    const it = this.objects.get(id);
    URL.revokeObjectURL(it.src);
    it.src = URL.createObjectURL(new Blob(it.parts?.splice(0), { type }));
  }
  async picture(it, width, scale) {
    if (!it.paused) await new Promise(done => setTimeout(done, it.due - performance.now()));
    it.due = performance.now() + 33;
    let frame;
    for (let tries = 0; !frame; tries++) {
      if (it.readyState < 2 || tries === 50) return null;
      try { frame = new VideoFrame(it); } catch { await new Promise(done => setTimeout(done, 10)); }
    }
    const height = Math.ceil(width * it.videoHeight / it.videoWidth);
    const context = (it.context ??= new OffscreenCanvas(1, 1).getContext("2d", { alpha: false }));
    Object.assign(context.canvas, { width, height });
    context.drawImage(frame, 0, 0, width, height);
    frame.close();
    if (scale > 0) {
      const [w, h] = [width / scale, height / scale];
      context.scale(scale, scale);
      const shade = context.createLinearGradient(0, h - 64, 0, h);
      shade.addColorStop(0, "#0000"), shade.addColorStop(1, "#000a");
      context.fillStyle = shade;
      context.fillRect(0, h - 64, w, 64);
      context.fillStyle = "#fff6";
      context.fillRect(16, h - 14, w - 32, 4);
      context.fillStyle = "#fff";
      context.fillRect(16, h - 14, (w - 32) * it.currentTime / it.duration, 4);
      context.font = "14px system-ui";
      const clock = time => Math.floor(time / 60) + ":" + String(Math.floor(time % 60)).padStart(2, "0");
      context.fillText(clock(it.currentTime) + " / " + clock(it.duration), 44, h - 25);
      context.translate(18, h - 37);
      context.fill(new Path2D(it.paused ? "M0 0l12 7-12 7z" : "M0 0h4v14H0zM8 0h4v14H8z"));
    }
    return new Uint8Array(await (await context.canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })).arrayBuffer()).toBase64();
  }
  set(id, name, value) { this.objects.get(id)[name] = value; }
  call(target, method, args) { target[method](...args)?.catch?.(() => {}); }
  ask(reply, method, ...args) {
    Promise.try(() => this[method](...args)).then(
      value => this.tell(reply, "reply", value),
      ({ name, message, constraint }) => this.tell(reply, "refusal", name, message, constraint),
    );
  }
  async perform(target, method, args) { await target[method](...args); }
  async decode(bytes, sampleRate) { return channelsOf(await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes)); }
  async capture(id, audio) {
    const [track] = (await navigator.mediaDevices.getUserMedia({ audio })).getAudioTracks();
    this.keep(id, track);
    return describe(track);
  }
  async constrain(track, constraints) { await track.applyConstraints(constraints); return describe(track); }
  async devices() {
    navigator.mediaDevices.ondevicechange ??= () => clients.forEach(it => it.tell(0, "devicechange"));
    return (await navigator.mediaDevices.enumerateDevices()).filter(it => it.kind !== "videoinput");
  }
  watch(id, method, length) {
    const key = id + method;
    clearInterval(this.watched.get(key));
    if (length === 0) return void this.watched.delete(key);
    const node = this.objects.get(id), data = new (method.includes("Byte") ? Uint8Array : Float32Array)(length);
    const push = () => (node[method](data), this.tell(id, "analysis", method, toText(data)));
    this.watched.set(key, setInterval(push, 33));
    push();
  }
  drop(id) {
    const it = this.objects.get(id);
    this.objects.delete(id);
    if (it instanceof AudioContext) clearInterval(it.timer), it.state === "closed" || it.close();
    else if (it instanceof MediaStreamTrack) it.stop();
    else if (it instanceof HTMLMediaElement) it.pause(), URL.revokeObjectURL(it.src), it.removeAttribute("src"), it.load();
  }
}

const clients = new Map();
globalThis.receive = (id, commands) => {
  let client = clients.get(id);
  if (!client) clients.set(id, (client = new Client(id)));
  for (const [name, ...args] of commands) {
    client.queue = client.queue.then(() => client[name](...args.map(client.value))).catch(error => client.tell(0, "failure", name + ": " + error));
  }
};
globalThis.leave = id => {
  const client = clients.get(id);
  clients.delete(id);
  client?.queue.then(() => {
    client.watched.forEach(clearInterval);
    for (const key of [...client.objects.keys()]) client.drop(key);
  });
};
`;

type Listener = { message(json: string): void; closed(): void };

let running: Host | undefined;
let nextClient = 1;

class Host {
  engine = engines.start();
  listeners = new Map<number, Listener>();
  session: Promise<string>;

  constructor() {
    this.engine.objects.set(this.engine.newId(), this);
    this.session = this.#open();
    this.session.then(undefined, () => this.engineClosed());
  }

  async #open() {
    const { engine } = this;
    const targetId = await engine.request("media");
    const { sessionId } = await engine.inspect("Target.attachToTarget", { targetId, flatten: true });
    engine.inspected.set(sessionId, (method: string, { payload }: any) => {
      if (method === "Inspector.targetCrashed") return this.engineClosed();
      if (method !== "Runtime.bindingCalled") return;
      const space = payload.indexOf(" ");
      this.listeners.$get(+payload.slice(0, space))?.message(payload.slice(space + 1));
    });
    await engine.inspect("Inspector.enable", {}, sessionId);
    await engine.inspect("Runtime.enable", {}, sessionId);
    await engine.inspect("Runtime.addBinding", { name: "send" }, sessionId);
    await engine.inspect("Runtime.evaluate", { expression: AGENT }, sessionId);
    return sessionId;
  }

  evaluate(expression: string) {
    this.session
      .then(id => this.engine.inspect("Runtime.evaluate", { expression, userGesture: true }, id))
      .then(undefined, () => {});
  }

  engineClosed() {
    if (running !== this) return;
    running = undefined;
    for (const listener of [...this.listeners.values()]) listener.closed();
    this.listeners.$clear();
  }
}

/** What `listener` gets is only as honest as the process of the page. */
function connect(listener: Listener) {
  if (!engines.isAvailable()) {
    setImmediate(listener.closed);
    return { send() {}, close() {} };
  }
  const host = (running ??= new Host());
  const id = nextClient++;
  const release = host.engine.hold();
  host.listeners.$set(id, listener);
  return {
    send: (json: string) => host.evaluate(`receive(${id},JSON.parse(${JSON.stringify(json)}))`),
    close() {
      if (host.listeners.$delete(id)) host.evaluate(`leave(${id})`);
      release();
    },
  };
}

let access: Record<string, string> = {};

/** The system asks on behalf of the process that has started the engine. */
async function askForAccess(type: string) {
  if (!engines.isAvailable()) return false;
  const engine = engines.start();
  if (engine.type !== "electron") return true;
  const release = engine.hold();
  try {
    const isGranted = await engine.perform("module", "systemPreferences", "askForMediaAccess", [type]);
    access[type] = isGranted ? "granted" : "denied";
    return isGranted;
  } finally {
    release();
  }
}

export default { accessTo: (type: string) => access[type], askForAccess, connect };
