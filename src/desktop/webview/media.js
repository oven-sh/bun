const toText = ({ buffer, byteOffset, byteLength }) => new Uint8Array(buffer, byteOffset, byteLength).toBase64();
const channelsOf = buffer =>
  Array.from({ length: buffer.numberOfChannels }, (_, i) => toText(buffer.getChannelData(i)));
const describe = track => [
  track.label,
  track.muted,
  JSON.stringify(track.getSettings()),
  JSON.stringify(track.getCapabilities()),
];
const LEAD = 0.04;
const CENSUS_NAME = crypto.randomUUID();
const CENSUS =
  "(" +
  (own => {
    const all = [],
      register = registerProcessor;
    globalThis.registerProcessor = function registerProcessor(name, processor) {
      register(name, processor);
      const params = [...(processor.parameterDescriptors ?? [])];
      all.push(name, params.length);
      for (const it of params)
        all.push(
          it.name,
          it.defaultValue ?? 0,
          it.minValue ?? -3.4028234663852886e38,
          it.maxValue ?? 3.4028234663852886e38,
          it.automationRate,
        );
    };
    register(
      own,
      class extends AudioWorkletProcessor {
        constructor() {
          super();
          this.port.postMessage(all);
        }
        process() {
          return false;
        }
      },
    );
  }) +
  ")('" +
  CENSUS_NAME +
  "')";
document.head.append(
  Object.assign(document.createElement("meta"), {
    httpEquiv: "Content-Security-Policy",
    content: "default-src blob: 'wasm-unsafe-eval'",
  }),
);
const ofElements =
  "canplay canplaythrough durationchange ended error loadeddata loadedmetadata pause playing resize seeked seeking timeupdate waiting";

class Client {
  objects = new Map();
  offsets = new Map();
  watched = new Map();
  queue = Promise.resolve();
  constructor(id) {
    this.tell = (...message) =>
      send(
        id +
          " " +
          message
            .flat()
            .map(it => String(it ?? "").replaceAll("\t", " "))
            .join("\t"),
      );
  }
  value = it => {
    if (Array.isArray(it)) return it.map(this.value);
    if (it === null || typeof it !== "object") return it;
    if ("key" in it) return this.objects.get(it.ref).parameters.get(it.key);
    if ("ref" in it) return it.part ? this.objects.get(it.ref)[it.part] : this.objects.get(it.ref);
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
    const report = () =>
      this.tell(id, "clock", context.currentTime + LEAD - offset, context.baseLatency, context.outputLatency + LEAD);
    context.timer = setInterval(report, 250);
    report();
  }
  offline(id, options) {
    this.objects.set(id, new OfflineAudioContext(options));
    this.offsets.set(id, 0);
  }
  async render(context) {
    const buffer = await context.startRendering();
    this.analyse(context);
    return [context.currentTime, ...channelsOf(buffer)];
  }
  async proceed(context) {
    const time = context.currentTime;
    await context.resume();
    return time;
  }
  async interrupt(context, time) {
    await context.suspend(time);
    this.analyse(context);
    return context.currentTime;
  }
  analyse(context) {
    for (const [id, it] of this.objects) {
      if (!(it instanceof AnalyserNode) || it.context !== context) continue;
      for (const method of [
        "getByteFrequencyData",
        "getFloatFrequencyData",
        "getByteTimeDomainData",
        "getFloatTimeDomainData",
      ]) {
        const data = new (method.includes("Byte") ? Uint8Array : Float32Array)(
          method.includes("Time") ? it.fftSize : it.frequencyBinCount,
        );
        (it[method](data), this.tell(id, "analysis", method, toText(data)));
      }
    }
  }
  node(id, context, type, options) {
    const node =
      type === "AudioDestinationNode"
        ? context.destination
        : type === "AudioListener"
          ? context.listener
          : type === "ScriptProcessorNode"
            ? context.createScriptProcessor(...options)
            : new globalThis[type](context, options);
    this.objects.set(id, node);
    if ("onended" in node) node.onended = () => this.tell(id, "ended");
    if ("onaudioprocess" in node)
      node.onaudioprocess = event => {
        node.outputs?.shift()?.forEach((it, at) => event.outputBuffer.copyToChannel(it, at));
        this.tell(id, "process", channelsOf(event.inputBuffer));
      };
  }
  async module(context, source) {
    const add = async text => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    };
    await (context.census ??= add(CENSUS));
    await add(source);
    const { port } = new AudioWorkletNode(context, CENSUS_NAME);
    return new Promise(done => (port.onmessage = ({ data }) => done(data)));
  }
  processor(id, context, name, numberOfInputs, numberOfOutputs, outputChannelCount, values, serialized) {
    const parameterData = Object.fromEntries(
      Array.from({ length: values.length / 2 }, (_, i) => values.slice(2 * i, 2 * i + 2)),
    );
    const options = {
      numberOfInputs,
      numberOfOutputs,
      parameterData,
      outputChannelCount: outputChannelCount ?? undefined,
    };
    const node = new AudioWorkletNode(context, name, {
      ...options,
      processorOptions: wire.decode(new Uint8Array(serialized, 4)),
    });
    this.objects.set(id, node);
    node.port.onmessage = ({ data }) => this.tell(id, "message", wire.encode(data).toBase64());
    node.onprocessorerror = ({ message }) => this.tell(id, "processorerror", message);
  }
  post(id, bytes) {
    this.objects.get(id).port.postMessage(wire.decode(new Uint8Array(bytes, 4)));
  }
  buffer(id, sampleRate, numberOfChannels, length) {
    this.objects.set(id, new AudioBuffer({ sampleRate, numberOfChannels, length }));
  }
  output(id, channels) {
    (this.objects.get(id).outputs ??= []).push(channels);
  }
  stream(id, tracks) {
    this.objects.set(id, new MediaStream(tracks));
  }
  trackOf(id, node) {
    this.objects.set(id, node.stream.getAudioTracks()[0]);
  }
  clone(id, track) {
    this.keep(id, track.clone());
  }
  keep(id, track) {
    this.objects.set(id, track);
    for (const type of ["ended", "mute", "unmute"]) track.addEventListener(type, () => this.tell(id, type));
  }
  recorder(id, stream, options) {
    const it = new MediaRecorder(stream, options);
    let told = Promise.resolve();
    const tell = (...message) => (told = told.then(() => Promise.all(message)).then(parts => this.tell(id, ...parts)));
    this.objects.set(id, it);
    it.onstart = () => tell("start", it.mimeType);
    it.onstop = () => tell("stop", it.state);
    it.onpause = it.onresume = it.onerror = ({ type }) => tell(type);
    it.ondataavailable = ({ type, data, timecode }) =>
      tell(
        type,
        data.type,
        timecode,
        data.arrayBuffer().then(all => new Uint8Array(all).toBase64()),
      );
  }
  element(id, name) {
    const it = Object.assign(document.createElement(name), { preload: "auto" });
    this.objects.set(id, it);
    const state = ({ type }) =>
      this.tell(
        id,
        type,
        it.currentTime,
        it.duration,
        it.readyState,
        it.error?.code,
        it.videoWidth,
        it.videoHeight,
        it.paused,
        it.seeking,
        it.seeks ?? 0,
        ...[it.buffered, it.played, it.seekable].map(all =>
          String(Array.from({ length: all.length }, (_, i) => [all.start(i), all.end(i)])),
        ),
      );
    for (const type of ofElements.split(" ")) it.addEventListener(type, state);
  }
  seek(id, time) {
    const it = this.objects.get(id);
    it.seeks = (it.seeks ?? 0) + 1;
    it.currentTime = time;
  }
  part(id, bytes) {
    (this.objects.get(id).parts ??= []).push(new Blob([bytes]));
  }
  source(id, type, fragment) {
    const it = this.objects.get(id);
    URL.revokeObjectURL(it.src.split("#")[0]);
    it.sent = null;
    it.src = URL.createObjectURL(new Blob(it.parts?.splice(0), { type })) + "#" + fragment;
  }
  /** Timers and idle tasks, which `convertToBlob()` waits for, can be rare in a page that is never shown. */
  async picture(it, width, onlyIfNew) {
    let frame;
    for (let tries = 0; !frame; tries++) {
      if (it.readyState < 2 || tries === 50) return null;
      try {
        frame = new VideoFrame(it);
      } catch {
        await new Promise(done => setTimeout(done, 10));
      }
    }
    const height = Math.ceil((width * it.videoHeight) / it.videoWidth),
      { timestamp } = frame,
      sent = String([timestamp, width, height]);
    if (onlyIfNew && it.sent === sent) return frame.close();
    it.sent = sent;
    const context = (it.context ??= document.createElement("canvas").getContext("2d", { alpha: false })),
      { canvas } = context;
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    context.drawImage(frame, 0, 0, width, height);
    frame.close();
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return [url.slice(url.indexOf(",") + 1), timestamp / 1e6];
  }
  set(target, name, value) {
    target[name] = value;
  }
  call(target, method, args) {
    target[method](...args)?.catch?.(() => {});
  }
  ask(reply, method, args) {
    Promise.try(() => this[method](...args)).then(
      value => this.tell(reply, "reply", value),
      ({ name, message, constraint }) => this.tell(reply, "refusal", name, message, constraint),
    );
  }
  async perform(target, method, ...args) {
    await target[method](...args);
  }
  async decode(bytes, sampleRate) {
    return channelsOf(await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes));
  }
  async capture(id, audio) {
    const [track] = (await navigator.mediaDevices.getUserMedia({ audio })).getAudioTracks();
    this.keep(id, track);
    return describe(track);
  }
  async constrain(track, constraints) {
    await track.applyConstraints(constraints);
    return describe(track);
  }
  async devices() {
    navigator.mediaDevices.ondevicechange ??= () => clients.forEach(it => it.tell(0, "devicechange"));
    return (await navigator.mediaDevices.enumerateDevices())
      .filter(it => it.kind !== "videoinput")
      .flatMap(it => [it.deviceId, it.kind, it.label, it.groupId]);
  }
  watch(id, method, length) {
    const key = id + method;
    clearInterval(this.watched.get(key));
    if (length === 0) return void this.watched.delete(key);
    const node = this.objects.get(id),
      data = new (method.includes("Byte") ? Uint8Array : Float32Array)(length);
    const push = () => (node[method](data), this.tell(id, "analysis", method, toText(data)));
    this.watched.set(key, setInterval(push, 33));
    push();
  }
  drop(id) {
    const it = this.objects.get(id);
    this.objects.delete(id);
    if (it instanceof AudioContext) (clearInterval(it.timer), it.state === "closed" || it.close());
    else if (it instanceof MediaStreamTrack || it instanceof MediaRecorder) it.stop();
    else if (it instanceof HTMLMediaElement)
      (it.pause(), URL.revokeObjectURL(it.src.split("#")[0]), it.removeAttribute("src"), it.load());
  }
}

const clients = new Map();
globalThis.receive = (id, commands) => {
  let client = clients.get(id);
  if (!client) clients.set(id, (client = new Client(id)));
  for (const [name, ...args] of commands) {
    client.queue = client.queue
      .then(() => client[name](...args.map(client.value)))
      .catch(error => client.tell(0, "failure", name + ": " + error));
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
