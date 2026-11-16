// Web Audio, the microphone and `<audio>`. The web engine has a copy of what makes or takes sound, while it does.
const idl = require("internal/desktop/web/idl");

const { error, expose, internal, need, scope } = idl;
const { core } = require("internal/desktop/web/dom");

const PLAYER_IDLE_MS = 20_000;
const now = () => performance.now() / 1000;
const toText = ({ buffer, byteOffset, byteLength }: ArrayBufferView) =>
  Buffer.from(buffer, byteOffset, byteLength).toString("base64");
const floats = (data: Float32Array) => ({ floats: toText(data) });

function fromText(text: string, Type: any) {
  const bytes = new Uint8Array(Buffer.from(`${text}`, "base64"));
  return new Type(bytes.buffer, 0, Math.floor(bytes.length / Type.BYTES_PER_ELEMENT));
}

let link: { send(json: string): void; close(): void } | undefined;
/** What was copied in an earlier one is gone. */
let era = 1;
let nextId = 1;
let outbox: unknown[][] = [];
let idle: Timer | undefined;
const known = new Map<number, WeakRef<Copied>>();
/** What keeps the engine running, and cannot be collected. */
const busy = new Set<Copied>();
const collected = new FinalizationRegistry<number>(id => known.$delete(id) && send("drop", id));

function flush() {
  if (outbox.length > 0) link?.send(JSON.stringify(outbox));
  outbox = [];
}

function send(...command: unknown[]) {
  if (link === undefined)
    link = scope.env.connectMedia({
      message: (json: string) => idl.runTask(receive, json),
      closed: () => idl.runTask(disconnect),
    });
  if (outbox.push(command) === 1) queueMicrotask(flush);
}

function receive(json: string) {
  const [id, type, ...args] = JSON.parse(json);
  if (type === "devicechange") idl.fire(scope.global.navigator.mediaDevices, type);
  else if (type === "failure") scope.env.console("warning", `${args[0]}`);
  else
    known
      .$get(id)
      ?.deref()
      ?.heard(type, ...args);
}

function disconnect() {
  clearTimeout(idle);
  link?.close();
  link = undefined;
  outbox = [];
  era++;
  const all = [...known.values()];
  known.$clear();
  busy.$clear();
  for (const it of all) it.deref()?.lost();
}
scope.cleanups.add(disconnect);

class Copied {
  id = nextId++;
  era = 0;

  get isCopied() {
    return this.era === era;
  }
  copy() {
    if (this.isCopied) return this;
    this.era = era;
    known.$set(this.id, new WeakRef(this));
    collected.register(this, this.id);
    this.create();
    return this;
  }
  setBusy(is: boolean) {
    if (is) busy.$add(this);
    else if (!busy.$delete(this)) return;
    clearTimeout(idle);
    if (busy.$size === 0) idle = setTimeout(() => idl.runTask(disconnect), PLAYER_IDLE_MS).unref();
  }
  invoke(method: string, ...args: unknown[]) {
    if (this.isCopied) send("call", this, method, args);
  }
  set(name: string, value: unknown) {
    if (this.isCopied) send("set", this.id, name, value);
  }
  drop() {
    this.setBusy(false);
    if (this.isCopied && known.$delete(this.id)) send("drop", this.id);
    this.era = 0;
  }
  toJSON(): object {
    return { ref: this.id };
  }
  create() {}
  heard(_type: string, ..._args: any[]) {}
  lost() {}
}

class Question extends Copied {
  answer = Promise.withResolvers<any>();

  heard(type: string, value: any, message?: string, constraint?: string) {
    this.setBusy(false);
    known.$delete(this.id);
    if (type === "reply") this.answer.resolve(value);
    else if (value === "OverconstrainedError") this.answer.reject(new OverconstrainedError(constraint, message));
    else this.answer.reject(idl.ownError({ name: `${value}`, message: `${message}` }));
  }
  lost() {
    this.answer.reject(error("AbortError", "The audio service has exited."));
  }
}

function ask(method: string, ...args: unknown[]): Promise<any> {
  const question = new Question().copy();
  question.setBusy(true);
  send("ask", question.id, method, ...args);
  return question.answer.promise;
}

const states = new WeakMap<object, any>();

function of<T>(self: any, Kind: new (...args: any[]) => T): T {
  const state = states.get(self);
  if (state instanceof Kind) return state;
  throw new TypeError("Illegal invocation, or a parameter is not of the right type.");
}

function attribute(
  ctor: any,
  name: string,
  Kind: any,
  read: (state: any) => unknown,
  write?: (state: any, value: any) => void,
) {
  const get = function (this: unknown) {
    return read(of(this, Kind));
  };
  const set = function (this: unknown, value: unknown) {
    write!(of(this, Kind), value);
  };
  core.accessor(ctor.prototype, name, get, write && set);
}

// ───────────────────────────── buffers and parameters ─────────────────────────────

class Samples extends Copied {
  constructor(
    readonly sampleRate: number,
    readonly channels: Float32Array[],
  ) {
    super();
  }
  create() {
    send("buffer", this.id, this.sampleRate, this.channels.map(floats));
  }
  /** What plays goes on with what it had. */
  channel(index: unknown) {
    const found = this.channels[(index as number) >>> 0];
    if (found === undefined) throw error("IndexSizeError", "There is no such channel.");
    this.era = 0;
    return found;
  }
}

function checkRate(rate: number) {
  if (rate >= 3000 && rate <= 768000) return rate;
  throw error("NotSupportedError", `The sample rate ${rate} is out of range.`);
}

class AudioBuffer {
  constructor(options: any, channels: any = undefined) {
    if (options?.[0] === internal) {
      states.set(this, new Samples(options[1], channels));
      return;
    }
    need(arguments.length, 1);
    const { length, numberOfChannels = 1, sampleRate } = idl.dictionary(options);
    if (length === undefined || sampleRate === undefined) throw new TypeError("length and sampleRate are required.");
    const count = numberOfChannels >>> 0;
    if (count < 1 || count > 32 || length >>> 0 === 0) throw error("NotSupportedError", "The size is out of range.");
    const rate = checkRate(Math.fround(idl.finite(sampleRate)));
    states.set(
      this,
      new Samples(
        rate,
        Array.from({ length: count }, () => new Float32Array(length >>> 0)),
      ),
    );
  }
  getChannelData(channel: number) {
    need(arguments.length, 1);
    return of(this, Samples).channel(channel);
  }
  copyFromChannel(destination: Float32Array, channel: number, offset = 0) {
    need(arguments.length, 2);
    destination.set(
      of(this, Samples)
        .channel(channel)
        .subarray((offset >>>= 0), offset + destination.length),
    );
  }
  copyToChannel(source: Float32Array, channel: number, offset = 0) {
    need(arguments.length, 2);
    const target = of(this, Samples)
      .channel(channel)
      .subarray(offset >>> 0);
    target.set(source.subarray(0, target.length));
  }
}
Object.defineProperty(AudioBuffer, "length", { value: 1 });
attribute(AudioBuffer, "sampleRate", Samples, it => it.sampleRate);
attribute(AudioBuffer, "length", Samples, it => it.channels[0].length);
attribute(AudioBuffer, "duration", Samples, it => it.channels[0].length / it.sampleRate);
attribute(AudioBuffer, "numberOfChannels", Samples, it => it.channels.length);

const bufferFrom = (rate: number, channels: string[]) =>
  new AudioBuffer(
    [internal, rate],
    channels.map(it => fromText(it, Float32Array)),
  );

type Automation = { method: string; value: any; time: number; more?: number };

class Param {
  value: number;
  rate = "a-rate";
  events: Automation[] = [];

  constructor(
    readonly node: Vertex,
    readonly name: string,
    readonly range: number[],
  ) {
    this.value = range[0];
  }
  toJSON() {
    return { ref: this.node.id, param: this.name };
  }
  tell({ method, value, time, more }: Automation) {
    const at = this.node.context.at(time);
    const args =
      value === undefined
        ? [at]
        : [typeof value === "number" ? value : floats(value), at, more].slice(0, more === undefined ? 2 : 3);
    send("call", this, method, args);
  }
  add(event: Automation) {
    if (event.time < 0 || event.more! < 0) throw new RangeError("The time must not be negative.");
    this.current();
    if (event.method.startsWith("cancel")) this.events = this.events.filter(it => it.time < event.time);
    else this.events.splice(this.events.findLastIndex(it => it.time <= event.time) + 1, 0, event);
    if (this.node.isCopied) this.tell(event);
  }
  #since = 0;
  /** And forgets what is over. */
  current() {
    const time = this.node.context.time();
    for (let next: Automation; (next = this.events[0]); this.events.shift()) {
      const { method, value, more } = next;
      if (method.endsWith("RampToValueAtTime") && time < next.time) {
        const done = (time - this.#since) / (next.time - this.#since);
        return Math.fround(
          method[0] === "l" ? this.value + (value - this.value) * done : this.value * (value / this.value) ** done || 0,
        );
      }
      if (time < next.time) break;
      if (method === "setValueCurveAtTime") {
        if (time < next.time + more!) return value[Math.floor(((time - next.time) / more!) * (value.length - 1))];
        this.value = value.at(-1);
      } else if (method === "setTargetAtTime") {
        const until = Math.min(time, this.events[1]?.time ?? Infinity);
        const reached = Math.fround(value + (this.value - value) * (Math.exp((next.time - until) / more!) || 0));
        if (until === time && until - next.time < more! * 20) return reached;
        this.value = reached;
      } else this.value = value;
      this.#since = next.time;
    }
    this.#since = time;
    return this.value;
  }
}

class AudioParam {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }
}
attribute(
  AudioParam,
  "value",
  Param,
  it => it.current(),
  (it, value) => {
    it.add({ method: "setValueAtTime", value: Math.fround(idl.finite(value)), time: it.node.context.time() });
  },
);
attribute(
  AudioParam,
  "automationRate",
  Param,
  it => it.rate,
  (it, value) => {
    if (value === "a-rate" || value === "k-rate") it.rate = value;
  },
);
["defaultValue", "minValue", "maxValue"].forEach((name, i) => attribute(AudioParam, name, Param, it => it.range[i]));
for (const [method, length] of Object.entries({
  ...{ setValueAtTime: 2, linearRampToValueAtTime: 2, exponentialRampToValueAtTime: 2, setTargetAtTime: 3 },
  ...{ setValueCurveAtTime: 3, cancelScheduledValues: 1, cancelAndHoldAtTime: 1 },
})) {
  const member = {
    [method](this: unknown, first: any, second: any, third: any) {
      need(arguments.length, length);
      const value =
        length === 1
          ? undefined
          : method === "setValueCurveAtTime"
            ? Float32Array.from(first)
            : Math.fround(idl.finite(first));
      if (method[0] === "e" && value === 0) throw new RangeError("The value must not be 0.");
      const more = length === 3 ? idl.finite(third) : undefined;
      of(this, Param).add({ method, value, time: idl.finite(length === 1 ? first : second), more });
      return this;
    },
  }[method];
  AudioParam.prototype[method] = Object.defineProperty(member, "length", { value: length });
}

class Wave extends Copied {
  constructor(
    readonly context: Context,
    readonly options: object,
  ) {
    super();
  }
  create() {
    send("node", this.id, this.context.copy().id, "PeriodicWave", this.options);
  }
}

class PeriodicWave {
  constructor(context: unknown, options: any = undefined) {
    const { real, imag, disableNormalization } = idl.dictionary(options);
    const list = (it: any) => it && Array.from(it, idl.finite);
    states.set(
      this,
      new Wave(of(context, Context), {
        real: list(real),
        imag: list(imag),
        disableNormalization: !!disableNormalization,
      }),
    );
  }
}

// ───────────────────────────── nodes ─────────────────────────────

type Edge = { to: Vertex | Param; output: number; input: number };

const encode = (value: any) =>
  value instanceof Float32Array ? floats(value) : $isObject(value) ? states.get(value).copy() : value;

class Vertex extends Copied {
  edges: Edge[] = [];
  values: Record<string, any> = {};
  params: Param[] = [];
  /** For the constructor. */
  options: any = {};
  /** By what another origin does not share. */
  isTainted = false;
  inputs = 1;
  outputs = 1;
  started: number[] | undefined;
  stopsAt: number | undefined;
  analyses: Record<string, { data: any; wanted: number; timer: Timer }> = {};

  constructor(
    readonly js: any,
    readonly context: Context,
    readonly type: string,
  ) {
    super();
  }
  create() {
    const { options } = this;
    const given = $isArray(options)
      ? options
      : Object.fromEntries(Object.keys(options).map(key => [key, encode(options[key])]));
    send("node", this.id, this.context.copy().id, this.type, given);
    for (const name in this.values) {
      if (!readOnly.includes(name) && this.values[name] !== defaultOf(this.type, name))
        this.set(name, encode(this.values[name]));
    }
    for (const param of this.params) {
      param.current();
      if (param.value !== param.range[0]) param.tell({ method: "setValueAtTime", value: param.value, time: 0 });
      for (const event of param.events) param.tell(event);
    }
    for (const edge of this.edges) this.tell(edge);
    if (this.type === "ScriptProcessorNode") this.context.processors.$add(this);
  }
  tell({ to, output, input }: Edge) {
    if (this.isTainted) return;
    if (to instanceof Param) to.node.copy();
    else to.copy();
    this.invoke("connect", ...(to instanceof Param ? [to, output] : [to, output, input]));
  }
  heard(type: string, first: any, second: any) {
    if (type === "ended") this.lost();
    else if (type === "analysis") {
      const analysis = this.analyses[first];
      if (analysis) analysis.data = fromText(second, first.includes("Byte") ? Uint8Array : Float32Array);
    } else if (type === "process" && this.context.state === "running") {
      const { sampleRate } = this.context;
      const outputBuffer = new AudioBuffer({
        sampleRate,
        length: this.values.bufferSize,
        numberOfChannels: this.options[2] || 1,
      });
      const init = { inputBuffer: bufferFrom(sampleRate, first), outputBuffer, playbackTime: this.context.time() };
      idl.dispatchInTask(this.js, new AudioProcessingEvent("audioprocess", init));
    }
  }
  lost() {
    this.analyses = {};
    if (this.started === undefined || this.stopsAt === -1) return;
    this.stopsAt = -1;
    this.drop();
    idl.fire(this.js, "ended");
  }
  /** It is what was measured last, for as long as something asks. */
  analyse(method: string, target: any, length: number, silence: number) {
    let analysis = this.analyses[method];
    if (this.isCopied && analysis?.wanted !== length) {
      clearTimeout(analysis?.timer);
      const stop = () => void (delete this.analyses[method], this.isCopied && send("watch", this.id, method, 0));
      analysis = this.analyses[method] = { data: null, wanted: length, timer: setTimeout(stop, 1000).unref() };
      send("watch", this.id, method, length);
    }
    analysis?.timer.refresh();
    if (analysis?.data) target.set(analysis.data.subarray(0, Math.min(length, target.length)));
    else target.fill(silence, 0, length);
  }
}

class AudioNode extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
  connect(destination: any, output = 0, input = 0) {
    need(arguments.length, 1);
    const it = of(this, Vertex);
    const to: Vertex | Param = destination instanceof AudioParam ? of(destination, Param) : of(destination, Vertex);
    const edge = { to, output: output >>> 0, input: input >>> 0 };
    if ((to instanceof Param ? to.node : to).context !== it.context)
      throw error("InvalidAccessError", "The node is of another context.");
    if (edge.output >= it.outputs || (to instanceof Vertex && edge.input >= to.inputs))
      throw error("IndexSizeError", "There is no such input or output.");
    if (!it.edges.some(other => other.to === to && other.output === edge.output && other.input === edge.input)) {
      it.edges.push(edge);
      if (it.isCopied) it.tell(edge);
    }
    return to instanceof Param ? undefined : destination;
  }
  disconnect(destination: any = undefined, output: any = undefined, input: any = undefined) {
    const it = of(this, Vertex);
    const to = $isObject(destination) ? states.get(destination) : undefined;
    if (to === undefined) output = destination;
    if (output >>> 0 >= Math.max(it.outputs, 1)) throw error("IndexSizeError", "There is no such output.");
    const matches = (edge: Edge) =>
      (to === undefined || edge.to === to) &&
      (output === undefined || edge.output === output >>> 0) &&
      (input === undefined || edge.input === input >>> 0);
    const cut = it.edges.filter(matches);
    if (to !== undefined && cut.length === 0)
      throw error("InvalidAccessError", "The given destination is not connected.");
    it.edges = it.edges.filter(edge => !matches(edge));
    for (const { to, output, input } of cut)
      it.invoke("disconnect", ...(to instanceof Param ? [to, output] : [to, output, input]));
  }
}
attribute(AudioNode, "context", Vertex, it => it.context.js);
attribute(AudioNode, "numberOfInputs", Vertex, it => it.inputs);
attribute(AudioNode, "numberOfOutputs", Vertex, it => it.outputs);

function reflect(ctor: any, name: string, initial: unknown) {
  attribute(
    ctor,
    name,
    Vertex,
    it => it.values[name],
    (it, value) => {
      if (typeof initial === "number") value = idl.finite(value);
      else if (typeof initial === "string") value = `${value}`;
      else if (typeof initial === "boolean") value = !!value;
      else if (value !== null && name === "buffer") of(value, Samples);
      else if (value !== null) value = Float32Array.from(value);
      if (name === "fftSize" && (value < 32 || value > 32768 || value & (value - 1)))
        throw error("IndexSizeError", "It has to be a power of 2.");
      it.values[name] = value;
      if (it.isCopied) it.set(name, encode(value));
    },
  );
}
const ofChannels = { channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
for (const name in ofChannels) reflect(AudioNode, name, ofChannels[name]);

class AudioScheduledSourceNode extends AudioNode {
  start(when = 0) {
    const it = of(this, Vertex);
    const args = Array.from(arguments, idl.finite).slice(0, it.type === "AudioBufferSourceNode" ? 3 : 1);
    if (it.started !== undefined) throw error("InvalidStateError", "It cannot be started more than once.");
    if (args.some(value => value < 0)) throw new RangeError("The time must not be negative.");
    it.started = args;
    if (it.context.state === "closed") return;
    it.copy().setBusy(true);
    it.invoke("start", it.context.at(+when), ...args.slice(1));
  }
  stop(when = 0) {
    const it = of(this, Vertex);
    if (it.started === undefined) throw error("InvalidStateError", "It has not been started.");
    if (idl.finite(when) < 0) throw new RangeError("The time must not be negative.");
    it.invoke("stop", it.context.at(+when));
  }
}
idl.defineHandlers(AudioScheduledSourceNode.prototype, ["ended"]);

const MOST = 3.4028234663852886e38;
const any = (initial: number) => [initial, -MOST, MOST];
const clamped = { channelCountMode: "clamped-max" };
type Kind = {
  values?: object;
  params?: Record<string, number[]>;
  channels?: object;
  isSource?: boolean;
  setUp?(it: Vertex, options: any): void;
};

const kinds: Record<string, Kind> = {
  AnalyserNode: { values: { fftSize: 2048, maxDecibels: -30, minDecibels: -100, smoothingTimeConstant: 0.8 } },
  AudioBufferSourceNode: {
    isSource: true,
    values: { buffer: null, loop: false, loopStart: 0, loopEnd: 0 },
    params: { playbackRate: any(1), detune: any(0) },
  },
  BiquadFilterNode: {
    values: { type: "lowpass" },
    params: {
      frequency: [350, 0, 24000],
      detune: [0, -153600, 153600],
      Q: any(1),
      gain: [0, -MOST, 1541.273681640625],
    },
  },
  ChannelMergerNode: {
    channels: { channelCount: 1, channelCountMode: "explicit" },
    setUp: (it, { numberOfInputs = 6 }) => (it.inputs = it.options.numberOfInputs = numberOfInputs >>> 0),
  },
  ChannelSplitterNode: {
    channels: { channelCountMode: "explicit", channelInterpretation: "discrete" },
    setUp: (it, { numberOfOutputs = 6 }) => (it.outputs = it.options.numberOfOutputs = numberOfOutputs >>> 0),
  },
  ConstantSourceNode: { isSource: true, params: { offset: any(1) } },
  ConvolverNode: { channels: clamped, values: { normalize: true, buffer: null } },
  DelayNode: {
    params: { delayTime: [0, 0, 1] },
    setUp: (it, { maxDelayTime = 1 }) => (it.options.maxDelayTime = idl.finite(maxDelayTime)),
  },
  DynamicsCompressorNode: {
    channels: clamped,
    params: {
      threshold: [-24, -100, 0],
      knee: [30, 0, 40],
      ratio: [12, 1, 20],
      attack: [Math.fround(0.003), 0, 1],
      release: [0.25, 0, 1],
    },
  },
  GainNode: { params: { gain: any(1) } },
  MediaElementAudioSourceNode: {
    setUp(it, { mediaElement }) {
      const player = playerOf(mediaElement);
      if (player.source) throw error("InvalidStateError", "The element is already connected to a node.");
      states.set((it.options.mediaElement = {}), player);
      it.values.mediaElement = mediaElement;
      it.inputs = 0;
      player.source = it;
      it.isTainted = player.isTainted;
      if (player.isCopied) it.copy();
    },
  },
  MediaStreamAudioDestinationNode: {
    channels: { channelCountMode: "explicit" },
    setUp(it) {
      it.outputs = 0;
      const track = new Track({ label: "MediaStreamAudioDestinationNode", settings: {}, capabilities: {} });
      track.create = () => send("trackOf", track.id, it.copy());
      it.values.stream = new MediaStream([track.js]);
    },
  },
  MediaStreamAudioSourceNode: {
    setUp(it, { mediaStream }) {
      if (of(mediaStream, Stream).tracks.length === 0)
        throw error("InvalidStateError", "The stream has no audio track.");
      it.options.mediaStream = it.values.mediaStream = mediaStream;
      it.inputs = 0;
      of(mediaStream, Stream).tracks[0].users.push(it);
      if (of(mediaStream, Stream).isActive()) it.copy();
    },
  },
  OscillatorNode: {
    isSource: true,
    values: { type: "sine" },
    params: { frequency: [440, -24000, 24000], detune: [0, -153600, 153600] },
  },
  StereoPannerNode: { channels: clamped, params: { pan: [0, -1, 1] } },
  WaveShaperNode: { values: { curve: null, oversample: "none" } },
};
const readOnly = ["bufferSize", "mediaElement", "mediaStream", "stream"];

function defaultOf(type: string, name: string) {
  return kinds[type]?.values?.[name] ?? kinds[type]?.channels?.[name] ?? ofChannels[name] ?? null;
}

function vertex(js: object, context: Context, type: string) {
  const it = new Vertex(js, context, type);
  Object.assign(it.values, ofChannels, kinds[type]?.channels, kinds[type]?.values);
  states.set(js, it);
  return it;
}

const nodes: Record<string, any> = {};
for (const type in kinds) {
  const { values = {}, params = {}, isSource, setUp } = kinds[type];
  const Base: any = isSource ? AudioScheduledSourceNode : AudioNode;
  const ctor = (nodes[type] = {
    [type]: class extends Base {
      constructor(context: unknown, options: any = undefined) {
        const owner = of(context, Context);
        options = idl.dictionary(options);
        super(internal);
        const it = vertex(this, owner, type);
        if (isSource) it.inputs = 0;
        for (const name in params) {
          const param = new Param(it, name, params[name]);
          if (options[name] !== undefined) param.value = Math.fround(idl.finite(options[name]));
          it.params.push(param);
          states.set((it.params[name] = new AudioParam(internal)), param);
        }
        for (const name in it.values) if (options[name] !== undefined) this[name] = options[name];
        setUp?.(it, options);
      }
    },
  }[type]);
  for (const name in values) reflect(ctor, name, values[name]);
  for (const name in params) attribute(ctor, name, Vertex, it => it.params[name]);
}
attribute(nodes.AnalyserNode, "frequencyBinCount", Vertex, it => it.values.fftSize / 2);
attribute(nodes.DynamicsCompressorNode, "reduction", Vertex, () => 0);
attribute(nodes.MediaElementAudioSourceNode, "mediaElement", Vertex, it => it.values.mediaElement);
attribute(nodes.MediaStreamAudioSourceNode, "mediaStream", Vertex, it => it.values.mediaStream);
attribute(nodes.MediaStreamAudioDestinationNode, "stream", Vertex, it => it.values.stream);
for (const [method, share, silence] of [
  ["getByteFrequencyData", 2, 0],
  ["getFloatFrequencyData", 2, -Infinity],
  ["getByteTimeDomainData", 1, 128],
  ["getFloatTimeDomainData", 1, 0],
] as const) {
  nodes.AnalyserNode.prototype[method] = {
    [method](this: unknown, array: any) {
      const it = of(this, Vertex);
      it.analyse(method, array, it.values.fftSize / share, silence);
    },
  }[method];
}
nodes.OscillatorNode.prototype.setPeriodicWave = function setPeriodicWave(wave: unknown) {
  const it = of(this, Vertex);
  it.values.type = "custom";
  it.options = { type: "custom", periodicWave: wave };
  if (it.isCopied) it.invoke("setPeriodicWave", of(wave, Wave).copy());
};

class AudioDestinationNode extends AudioNode {
  get maxChannelCount() {
    return of(this, Vertex) && 2;
  }
}

/** What it is given to fill is not heard. */
class ScriptProcessorNode extends AudioNode {
  get bufferSize() {
    return of(this, Vertex).values.bufferSize;
  }
}
idl.defineHandlers(ScriptProcessorNode.prototype, ["audioprocess"]);

const asBuffer = (value: unknown) => of(value, Samples) && value;
const AudioProcessingEvent = idl.eventClass("AudioProcessingEvent", {
  playbackTime: [idl.finite],
  inputBuffer: [asBuffer],
  outputBuffer: [asBuffer],
});

// ───────────────────────────── contexts ─────────────────────────────

class Context extends Copied {
  state = "running";
  wanted = "running";
  sinkId = "";
  baseLatency = 0.01;
  outputLatency = 0;
  destination: object | undefined;
  processors = new Set<Vertex>();
  /** What the clock said at `#at`. It stands still while that is NaN. */
  #base = 0;
  #at = now();
  #last = 0;

  constructor(
    readonly js: object,
    readonly sampleRate: number,
    readonly latencyHint: unknown,
  ) {
    super();
  }
  time() {
    const blocks = Math.floor(((this.#base + now() - this.#at) * this.sampleRate) / 128);
    const time = (blocks * 128) / this.sampleRate;
    return time > this.#last ? (this.#last = time) : this.#last;
  }
  at(time: number) {
    return { time, of: this.id };
  }
  #setClock(time: number, runs: boolean) {
    this.#base = time;
    this.#at = runs ? now() : NaN;
  }
  create() {
    const time = this.time();
    this.#setClock(time, false);
    send("context", this.id, { sampleRate: this.sampleRate, latencyHint: this.latencyHint, sinkId: this.sinkId }, time);
    if (this.wanted !== "running") this.invoke("suspend");
  }
  heard(_: string, time: number, baseLatency: number, outputLatency: number) {
    this.#setClock(+time, this.state === "running");
    this.baseLatency = +baseLatency;
    this.outputLatency = +outputLatency;
  }
  lost() {
    this.processors.$clear();
    this.#setClock(this.time(), this.state === "running");
  }
  change(state: string): Promise<void> {
    if (this.wanted === "closed") return Promise.$reject(error("InvalidStateError", "The context is closed."));
    this.wanted = state;
    if (state !== "closed") this.invoke(state === "running" ? "resume" : "suspend");
    else {
      for (const it of [...busy]) if (it instanceof Vertex && it.context === this) it.drop();
      this.processors.$clear();
      this.drop();
    }
    return new Promise(resolve =>
      idl.queueTask(() => {
        const isChanged = this.state !== state;
        if (isChanged) this.#setClock(this.time(), state === "running");
        this.state = state;
        resolve();
        if (isChanged) idl.fire(this.js, "statechange");
      }),
    );
  }
}

class BaseAudioContext extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    need(arguments.length, 3);
    return new AudioBuffer({ numberOfChannels, length, sampleRate });
  }
  createChannelMerger(numberOfInputs = 6) {
    return new nodes.ChannelMergerNode(this, { numberOfInputs });
  }
  createChannelSplitter(numberOfOutputs = 6) {
    return new nodes.ChannelSplitterNode(this, { numberOfOutputs });
  }
  createDelay(maxDelayTime = 1) {
    return new nodes.DelayNode(this, { maxDelayTime });
  }
  createPeriodicWave(real: unknown, imag: unknown, constraints: any = undefined) {
    need(arguments.length, 2);
    return new PeriodicWave(this, { real, imag, ...idl.dictionary(constraints) });
  }
  createScriptProcessor(bufferSize = 0, inputs = 2, outputs = 2) {
    const size = bufferSize >>> 0 || 1024;
    if (size < 256 || size > 16384 || size & (size - 1) || inputs > 32 || outputs > 32 || (!inputs && !outputs)) {
      throw error("IndexSizeError", "The size of the buffer or the number of channels is out of range.");
    }
    const node = new ScriptProcessorNode(internal);
    const it = vertex(node, of(this, Context), "ScriptProcessorNode");
    it.options = [size, inputs >>> 0, outputs >>> 0];
    it.values.bufferSize = size;
    return node;
  }
  async decodeAudioData(data: ArrayBuffer, success: any = undefined, failure: any = undefined) {
    const { sampleRate } = of(this, Context);
    if (!$inheritsArrayBuffer(data)) throw new TypeError("parameter 1 is not of type 'ArrayBuffer'.");
    if (data.detached) throw error("DataCloneError", "Cannot decode a detached ArrayBuffer.");
    try {
      const buffer = bufferFrom(
        sampleRate,
        await ask("decode", { bytes: toText(new Uint8Array(data.transfer())) }, sampleRate),
      );
      if (success) idl.queueTask(success, buffer);
      return buffer;
    } catch (thrown) {
      if (failure) idl.queueTask(failure, thrown);
      throw thrown;
    }
  }
}
for (const name of core.splitTokens(`Analyser BiquadFilter BufferSource ConstantSource Convolver DynamicsCompressor Gain Oscillator
  StereoPanner WaveShaper`)) {
  BaseAudioContext.prototype["create" + name] = {
    ["create" + name](this: unknown) {
      return new (nodes[name + "Node"] ?? nodes.AudioBufferSourceNode)(this);
    },
  }["create" + name];
}
attribute(BaseAudioContext, "currentTime", Context, it => it.time());
attribute(BaseAudioContext, "sampleRate", Context, it => it.sampleRate);
attribute(BaseAudioContext, "state", Context, it => it.state);
attribute(BaseAudioContext, "destination", Context, it => {
  if (it.destination) return it.destination;
  const node = vertex((it.destination = new AudioDestinationNode(internal)), it, "AudioDestinationNode");
  node.outputs = 0;
  return it.destination;
});
idl.defineHandlers(BaseAudioContext.prototype, ["statechange"]);

class AudioContext extends BaseAudioContext {
  constructor(options: any = undefined) {
    const { latencyHint = "interactive", sampleRate = 48000, sinkId } = idl.dictionary(options);
    const rate = checkRate(Math.fround(idl.finite(sampleRate)));
    super(internal);
    const it = new Context(this, rate, typeof latencyHint === "number" ? latencyHint : `${latencyHint}`);
    if (typeof sinkId === "string") it.sinkId = sinkId;
    states.set(this, it);
    idl.queueTask(() => idl.fire(this, "statechange"));
  }
  async resume() {
    await of(this, Context).change("running");
  }
  async suspend() {
    await of(this, Context).change("suspended");
  }
  async close() {
    await of(this, Context).change("closed");
  }
  async setSinkId(sinkId: unknown) {
    const it = of(this, Context);
    if (it.sinkId === `${sinkId}`) return;
    if (it.isCopied) await ask("perform", it, "setSinkId", [`${sinkId}`]);
    it.sinkId = `${sinkId}`;
    idl.fire(this, "sinkchange");
  }
  getOutputTimestamp() {
    const it = of(this, Context);
    return { contextTime: Math.max(0, it.time() - it.outputLatency), performanceTime: scope.global.performance.now() };
  }
  createMediaElementSource(mediaElement: unknown) {
    return new nodes.MediaElementAudioSourceNode(this, { mediaElement });
  }
  createMediaStreamSource(mediaStream: unknown) {
    return new nodes.MediaStreamAudioSourceNode(this, { mediaStream });
  }
  createMediaStreamDestination() {
    return new nodes.MediaStreamAudioDestinationNode(this);
  }
}
for (const name of ["baseLatency", "outputLatency", "sinkId"]) attribute(AudioContext, name, Context, it => it[name]);
idl.defineHandlers(AudioContext.prototype, ["error", "sinkchange"]);

// ───────────────────────────── streams ─────────────────────────────

class OverconstrainedError extends DOMException {
  #constraint: string;

  constructor(constraint: unknown, message: unknown = "") {
    need(arguments.length, 1);
    super(`${message}`, "OverconstrainedError");
    this.#constraint = `${constraint}`;
  }
  get constraint() {
    return this.#constraint;
  }
}

class Track extends Copied {
  js = new MediaStreamTrack(internal);
  uuid = crypto.randomUUID();
  enabled = true;
  contentHint = "";
  readyState = "live";
  constraints = {};
  users: object[] = [];

  constructor(public about: any) {
    super();
    states.set(this.js, this);
  }
  heard(type: string) {
    if (type === "ended") return this.lost();
    this.about.muted = type === "mute";
    idl.fire(this.js, type === "mute" ? type : "unmute");
  }
  lost() {
    if (!busy.$has(this) && this.create !== Copied.prototype.create) return;
    if (this.readyState === "ended") return;
    this.stop();
    idl.fire(this.js, "ended");
  }
  stop() {
    this.readyState = "ended";
    this.drop();
  }
}

class MediaStreamTrack extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
  stop() {
    of(this, Track).stop();
  }
  clone() {
    const it = of(this, Track);
    const copy = new Track(structuredClone(it.about));
    Object.assign(copy, { enabled: it.enabled, readyState: it.readyState, constraints: it.constraints });
    if (it.readyState === "live") {
      send("clone", copy.copy().id, it.copy());
      copy.setBusy(true);
    }
    return copy.js;
  }
  getSettings() {
    return structuredClone(of(this, Track).about.settings);
  }
  getCapabilities() {
    return structuredClone(of(this, Track).about.capabilities);
  }
  getConstraints() {
    return structuredClone(of(this, Track).constraints);
  }
  async applyConstraints(constraints: any = undefined) {
    const it = of(this, Track);
    constraints = JSON.parse(JSON.stringify(idl.dictionary(constraints)));
    if (it.isCopied) it.about = await ask("constrain", it, constraints);
    it.constraints = constraints;
  }
}
attribute(MediaStreamTrack, "kind", Track, () => "audio");
attribute(MediaStreamTrack, "id", Track, it => it.uuid);
attribute(MediaStreamTrack, "label", Track, it => `${it.about.label}`);
attribute(MediaStreamTrack, "muted", Track, it => !!it.about.muted);
attribute(MediaStreamTrack, "readyState", Track, it => it.readyState);
attribute(
  MediaStreamTrack,
  "enabled",
  Track,
  it => it.enabled,
  (it, value) => it.set("enabled", (it.enabled = !!value)),
);
attribute(
  MediaStreamTrack,
  "contentHint",
  Track,
  it => it.contentHint,
  (it, value) => it.set("contentHint", (it.contentHint = `${value}`)),
);
idl.defineHandlers(MediaStreamTrack.prototype, ["ended", "mute", "unmute"]);

class Stream extends Copied {
  uuid = crypto.randomUUID();
  tracks: Track[] = [];

  create() {
    send(
      "stream",
      this.id,
      this.tracks.filter(it => it.readyState === "live").map(it => it.copy()),
    );
  }
  isActive() {
    return this.tracks.some(it => it.readyState === "live");
  }
}

class MediaStream extends idl.EventTarget {
  constructor(given: any = undefined) {
    const tracks = given === undefined ? [] : given instanceof MediaStream ? given.getTracks() : idl.sequence(given);
    super();
    states.set(this, new Stream());
    for (const track of tracks) this.addTrack(track);
  }
  getTracks() {
    return of(this, Stream).tracks.map(it => it.js);
  }
  getAudioTracks() {
    return of(this, Stream).tracks.map(it => it.js);
  }
  getVideoTracks() {
    return of(this, Stream) && [];
  }
  getTrackById(id: string) {
    need(arguments.length, 1);
    return of(this, Stream).tracks.find(it => it.uuid === `${id}`)?.js ?? null;
  }
  addTrack(track: unknown) {
    const [it, added] = [of(this, Stream), of(track, Track)];
    if (it.tracks.includes(added)) return;
    it.tracks.push(added);
    if (it.isCopied && added.readyState === "live") it.invoke("addTrack", added.copy());
  }
  removeTrack(track: unknown) {
    const [it, removed] = [of(this, Stream), of(track, Track)];
    it.tracks = it.tracks.filter(other => other !== removed);
    if (removed.isCopied) it.invoke("removeTrack", removed);
  }
  clone() {
    return new MediaStream(this.getTracks().map(it => it.clone()));
  }
}
attribute(MediaStream, "id", Stream, it => it.uuid);
attribute(MediaStream, "active", Stream, it => it.isActive());
idl.defineHandlers(MediaStream.prototype, ["addtrack", "removetrack"]);

class MediaDeviceInfo {
  #it: any;

  constructor(key: unknown = undefined, it?: object) {
    idl.illegal(key);
    this.#it = it;
  }
  static {
    for (const name of ["deviceId", "kind", "label", "groupId"])
      idl.attribute(this, name, self => `${self.#it[name] ?? ""}`);
  }
  toJSON() {
    const { deviceId, kind, label, groupId } = this as any;
    return { deviceId, kind, label, groupId };
  }
}

let devices: object[] = [{ kind: "audioinput" }, { kind: "audiooutput" }];

class MediaDevices extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }
  /** The engine is not started for a page that is just curious. */
  async enumerateDevices() {
    const isWorthIt = link !== undefined || scope.page.isActive();
    if (isWorthIt && scope.env.checkPermission("media", { mediaType: "audio" }) === "granted")
      devices = await ask("devices");
    return devices.map(it => new MediaDeviceInfo(internal, it));
  }
  getSupportedConstraints() {
    const names =
      "autoGainControl channelCount deviceId echoCancellation groupId latency noiseSuppression sampleRate sampleSize voiceIsolation";
    return Object.fromEntries(names.split(" ").map(name => [name, true]));
  }
  async getUserMedia(constraints: any = undefined) {
    const { audio, video } = idl.dictionary(constraints);
    if (!audio && !video) throw new TypeError("At least one of audio and video must be requested.");
    if (scope.disposed) throw error("InvalidStateError", "The document is not active.");
    if (video) throw error("NotFoundError", "Requested device not found");
    const wanted = $isObject(audio) ? JSON.parse(JSON.stringify(audio)) : {};
    if ((await idl.adopt(scope.env.requestMicrophone(), String)) !== "granted")
      throw error("NotAllowedError", "Permission denied");
    const track = new Track({}).copy();
    track.constraints = wanted;
    track.about = await ask("capture", track.id, wanted);
    track.setBusy(true);
    return new MediaStream([track.js]);
  }
  async getDisplayMedia() {
    throw error("NotSupportedError", "Not supported");
  }
}
idl.defineHandlers(MediaDevices.prototype, ["devicechange"]);

// ───────────────────────────── elements ─────────────────────────────

const PART = 3 << 20;

/** For `dom/loader`, which has the attributes in `media`. */
class Player extends Copied {
  source: Vertex | undefined;
  #serial = 0;
  #base = 0;
  #at = NaN;

  constructor(
    readonly media: any,
    readonly fire: (type: string) => void,
    readonly fetch: () => Promise<{ bytes: Uint8Array; mime: string; isReadable?: boolean } | null>,
  ) {
    super();
  }
  create() {
    const { media } = this;
    send("element", this.id, media.node.name);
    this.source?.copy();
    for (const name of ["volume", "muted", "defaultPlaybackRate", "playbackRate", "preservesPitch", "loop"])
      this.set(name, media[name]);
    if (media.sinkId) this.invoke("setSinkId", media.sinkId);
  }
  #loading: Promise<boolean> | undefined;
  load() {
    if (this.#loading && this.isCopied) return this.#loading;
    const serial = ++this.#serial;
    const { srcObject } = this.media;
    this.copy();
    if (srcObject) this.set("srcObject", of(srcObject, Stream).copy());
    this.setBusy(true);
    return (this.#loading = (srcObject ? Promise.$resolve(null) : this.fetch()).then(resource => {
      if (serial !== this.#serial || !this.isCopied) return false;
      this.setBusy(!this.media.paused);
      if (srcObject) return true;
      if (resource === null) return (this.heard("error", 0, "NaN", 0, 4), false);
      if (resource.isReadable === false) this.taint();
      for (let at = 0; at < resource.bytes.length; at += PART) {
        send("part", this.id, { bytes: toText(resource.bytes.subarray(at, at + PART)) });
        flush();
      }
      send("source", this.id, resource.mime);
      if (this.#base > 0) this.set("currentTime", this.#base);
      return true;
    }));
  }
  isTainted = false;
  taint() {
    this.isTainted = true;
    if (!this.source) return;
    this.source.isTainted = true;
    this.source.invoke("disconnect");
  }
  unload() {
    this.isTainted = false;
    if (this.source) this.source.isTainted = false;
    this.#serial++;
    this.#loading = undefined;
    this.#base = 0;
    this.#at = NaN;
    this.source?.drop();
    this.drop();
  }
  async play() {
    this.setBusy(true);
    if (!(await this.load()))
      throw error(this.media.error ? "NotSupportedError" : "AbortError", "The element has nothing to play.");
    if (this.media.paused) throw error("AbortError", "The play() request was interrupted by a call to pause().");
    await ask("perform", this, "play", []);
  }
  pause() {
    this.#base = this.time();
    this.#at = NaN;
    this.invoke("pause");
    this.setBusy(false);
    if (this.media.videoWidth > 0) queueMicrotask(() => this.repaint());
  }
  time() {
    const passed = (now() - this.#at) * this.media.playbackRate || 0;
    return Math.min(this.#base + passed, this.media.duration || Infinity);
  }
  seek(time: number) {
    this.#base = time;
    this.#at = NaN;
    this.set("currentTime", time);
  }
  async setSinkId(id: string) {
    if (this.isCopied) await ask("perform", this, "setSinkId", [id]);
  }
  heard(
    type: string,
    time: number,
    duration: string,
    readyState: number,
    code?: number,
    width?: number,
    height?: number,
  ) {
    const { media } = this;
    if (/^(?:abort|emptied|play|ratechange)$/.test(type) || (type === "pause" && media.paused)) return;
    if (type === "pause" || type === "error") media.paused = true;
    this.#base = +time;
    this.#at = !media.paused && (type === "playing" || type === "timeupdate") ? now() : NaN;
    media.duration = +duration;
    media.readyState = readyState | 0;
    media.seeking = type === "seeking";
    if (type === "error") media.fail(code! | 0);
    if (media.paused) this.setBusy(false);
    media.videoWidth = width! | 0;
    media.videoHeight = height! | 0;
    if (media.videoWidth === 0) return this.fire(`${type}`);
    const serial = this.#serial;
    const shown = /^(?:loadeddata|seeked)$/.test(type) ? this.#show() : undefined;
    this.#told = this.#told.then(() => shown).then(() => serial === this.#serial && idl.runTask(this.fire, `${type}`));
    if (type === "playing" || type === "pause") this.repaint();
  }
  /** What a video tells waits for the picture that goes with it. */
  #told: Promise<unknown> = Promise.$resolve();
  async #show() {
    const serial = this.#serial;
    const picture = await ask("picture", this, ...this.media.pictureWanted()).then(undefined, () => null);
    if (picture && serial === this.#serial)
      await this.media.show(Buffer.from(`${picture}`, "base64"), () => serial === this.#serial);
  }
  #isPainting = false;
  async repaint() {
    if (this.#isPainting) return;
    this.#isPainting = true;
    for (let isLast = false; !isLast && this.isCopied;) {
      isLast = this.media.paused;
      if (isLast || this.media.isSeen()) await this.#show();
      else await Bun.sleep(250);
    }
    this.#isPainting = false;
  }
  lost() {
    this.#loading = undefined;
    if (this.media.paused) return;
    this.media.paused = true;
    this.pause();
    this.fire("pause");
  }
}

function playerOf(element: any): Player {
  const player = core.nodeOf(element)?.x?.player?.();
  if (player instanceof Player) return player;
  throw new TypeError("parameter 1 is not of type 'HTMLMediaElement'.");
}

const interfaces = {
  ...{
    AudioBuffer,
    AudioContext,
    AudioDestinationNode,
    AudioNode,
    AudioParam,
    AudioScheduledSourceNode,
    BaseAudioContext,
  },
  ...{
    MediaDeviceInfo,
    MediaDevices,
    MediaStream,
    MediaStreamTrack,
    OverconstrainedError,
    PeriodicWave,
    ScriptProcessorNode,
  },
  ...nodes,
};
for (const it of Object.values(interfaces)) expose(it);

export default { ...interfaces, AudioProcessingEvent, Player };
