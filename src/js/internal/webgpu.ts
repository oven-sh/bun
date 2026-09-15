// The WebGPU classes that are written in JavaScript: the ones that inherit from
// a platform class (GPUDevice from EventTarget, GPUUncapturedErrorEvent from
// Event, GPUPipelineError from DOMException), the read-only set-likes, and the
// plain data carriers. The resource classes (GPUBuffer, GPUTexture, the
// encoders...) are native: src/runtime/webgpu/.
//
// Native code reaches this module through the `create*` exports at the bottom.

// Proof that a constructor was called from here and not by user code. Every
// class below is "Illegal constructor" to anyone who does not hold it.
const kConstruct = Symbol("webgpu.construct");

const inspect = Symbol.for("nodejs.util.inspect.custom");

function checkKey(key: unknown) {
  if (key !== kConstruct) throw $ERR_ILLEGAL_CONSTRUCTOR();
}

// `readonly setlike<DOMString>`
class ReadonlyStringSet {
  #set: Set<string>;

  constructor(key: unknown, names: string[]) {
    checkKey(key);
    this.#set = new Set(names);
  }

  get size() {
    return this.#set.size;
  }

  has(value: string) {
    return this.#set.has(value);
  }

  keys() {
    return this.#set.keys();
  }

  values() {
    return this.#set.values();
  }

  entries() {
    return this.#set.entries();
  }

  forEach(callback: (value: string, key: string, set: this) => void, thisArg?: unknown) {
    if (!$isCallable(callback)) throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
    for (const value of this.#set) callback.$call(thisArg, value, value, this);
  }

  [Symbol.iterator]() {
    return this.#set.values();
  }

  [inspect]() {
    return this.#set;
  }
}

class GPUSupportedFeatures extends ReadonlyStringSet {}
class WGSLLanguageFeatures extends ReadonlyStringSet {}

type Limits = Record<string, number>;

class GPUSupportedLimits {
  #limits: Limits;

  constructor(key: unknown, limits: Limits) {
    checkKey(key);
    this.#limits = limits;
  }

  static {
    for (const name of [
      "maxTextureDimension1D",
      "maxTextureDimension2D",
      "maxTextureDimension3D",
      "maxTextureArrayLayers",
      "maxBindGroups",
      "maxBindGroupsPlusVertexBuffers",
      "maxBindingsPerBindGroup",
      "maxDynamicUniformBuffersPerPipelineLayout",
      "maxDynamicStorageBuffersPerPipelineLayout",
      "maxSampledTexturesPerShaderStage",
      "maxSamplersPerShaderStage",
      "maxStorageBuffersPerShaderStage",
      "maxStorageTexturesPerShaderStage",
      "maxUniformBuffersPerShaderStage",
      "maxUniformBufferBindingSize",
      "maxStorageBufferBindingSize",
      "minUniformBufferOffsetAlignment",
      "minStorageBufferOffsetAlignment",
      "maxVertexBuffers",
      "maxBufferSize",
      "maxVertexAttributes",
      "maxVertexBufferArrayStride",
      "maxInterStageShaderVariables",
      "maxColorAttachments",
      "maxColorAttachmentBytesPerSample",
      "maxComputeWorkgroupStorageSize",
      "maxComputeInvocationsPerWorkgroup",
      "maxComputeWorkgroupSizeX",
      "maxComputeWorkgroupSizeY",
      "maxComputeWorkgroupSizeZ",
      "maxComputeWorkgroupsPerDimension",
    ]) {
      Object.defineProperty(this.prototype, name, {
        get(this: GPUSupportedLimits) {
          return this.#limits[name];
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  [inspect]() {
    return { ...this.#limits };
  }
}

type AdapterInfo = {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  subgroupMinSize: number;
  subgroupMaxSize: number;
  isFallbackAdapter: boolean;
};

class GPUAdapterInfo {
  #info: AdapterInfo;

  constructor(key: unknown, info: AdapterInfo) {
    checkKey(key);
    this.#info = info;
  }

  get vendor() {
    return this.#info.vendor;
  }
  get architecture() {
    return this.#info.architecture;
  }
  get device() {
    return this.#info.device;
  }
  get description() {
    return this.#info.description;
  }
  get subgroupMinSize() {
    return this.#info.subgroupMinSize;
  }
  get subgroupMaxSize() {
    return this.#info.subgroupMaxSize;
  }
  get isFallbackAdapter() {
    return this.#info.isFallbackAdapter;
  }

  [inspect]() {
    return { ...this.#info };
  }
}

class GPUDeviceLostInfo {
  #reason: "unknown" | "destroyed";
  #message: string;

  constructor(key: unknown, reason: "unknown" | "destroyed", message: string) {
    checkKey(key);
    this.#reason = reason;
    this.#message = message;
  }

  get reason() {
    return this.#reason;
  }
  get message() {
    return this.#message;
  }
}

type CompilationMessage = { message: string; lineNum: number; linePos: number; offset: number; length: number };

class GPUCompilationMessage {
  #m: CompilationMessage;

  constructor(key: unknown, m: CompilationMessage) {
    checkKey(key);
    this.#m = m;
  }

  get message() {
    return this.#m.message;
  }
  // naga stops at the first error and reports nothing below that severity.
  get type() {
    return "error";
  }
  get lineNum() {
    return this.#m.lineNum;
  }
  get linePos() {
    return this.#m.linePos;
  }
  get offset() {
    return this.#m.offset;
  }
  get length() {
    return this.#m.length;
  }
}

class GPUCompilationInfo {
  #messages: readonly GPUCompilationMessage[];

  constructor(key: unknown, messages: CompilationMessage[]) {
    checkKey(key);
    this.#messages = Object.freeze(messages.map(m => new GPUCompilationMessage(kConstruct, m)));
  }

  get messages() {
    return this.#messages;
  }
}

// GPUError is not an Error: the spec gives it only `message`.
class GPUError {
  #message: string;

  constructor(message: string) {
    if (new.target === GPUError) throw $ERR_ILLEGAL_CONSTRUCTOR();
    if (arguments.length === 0) throw $ERR_MISSING_ARGS("message");
    this.#message = `${message}`;
  }

  get message() {
    return this.#message;
  }
}

class GPUValidationError extends GPUError {}
class GPUOutOfMemoryError extends GPUError {}
class GPUInternalError extends GPUError {}

// Index = `bun_webgpu::ErrorKind`.
const errorClasses = [GPUValidationError, GPUOutOfMemoryError, GPUInternalError];

function makeError(kind: number, message: string): GPUError {
  return new errorClasses[kind](message);
}

class GPUPipelineError extends DOMException {
  #reason: "validation" | "internal";

  constructor(message: string = "", options: { reason: "validation" | "internal" }) {
    if (options === undefined || options === null || typeof options !== "object") {
      throw new TypeError("GPUPipelineError: the second argument has to be a GPUPipelineErrorInit");
    }
    const reason = `${options.reason}`;
    if (reason !== "validation" && reason !== "internal") {
      throw new TypeError(`GPUPipelineError: '${reason}' is not a valid GPUPipelineErrorReason`);
    }
    super(message, "GPUPipelineError");
    this.#reason = reason;
  }

  get reason() {
    return this.#reason;
  }
}

class GPUUncapturedErrorEvent extends Event {
  #error: GPUError;

  constructor(type: string, init: EventInit & { error: GPUError }) {
    if (init === undefined || init === null || !(init.error instanceof GPUError)) {
      throw new TypeError("GPUUncapturedErrorEvent: init.error has to be a GPUError");
    }
    super(type, init);
    this.#error = init.error;
  }

  get error() {
    return this.#error;
  }
}

// The shape of the native `GPUDeviceHandle` (src/runtime/webgpu/device.rs).
type DeviceHandle = Record<string, any>;

class GPUDevice extends EventTarget {
  #handle: DeviceHandle;
  #onuncapturederror: ((event: GPUUncapturedErrorEvent) => unknown) | null = null;

  constructor(key: unknown, handle: DeviceHandle) {
    checkKey(key);
    super();
    this.#handle = handle;
    handle.setErrorHandler((kind: number, message: string) => {
      const error = makeError(kind, message);
      const event = new GPUUncapturedErrorEvent("uncapturederror", { error, cancelable: true });
      this.dispatchEvent(event);
      if (!event.defaultPrevented) {
        console.warn(`${error.constructor.name} (uncaptured): ${message}`);
      }
    });
  }

  get label() {
    return this.#handle.label;
  }
  set label(value: string) {
    this.#handle.label = value;
  }

  get features() {
    return this.#handle.features;
  }
  get limits() {
    return this.#handle.limits;
  }
  get adapterInfo() {
    return this.#handle.adapterInfo;
  }
  get queue() {
    return this.#handle.queue;
  }
  get lost() {
    return this.#handle.lost;
  }

  get onuncapturederror() {
    return this.#onuncapturederror;
  }
  set onuncapturederror(value) {
    const previous = this.#onuncapturederror;
    if (previous) this.removeEventListener("uncapturederror", previous as EventListener);
    this.#onuncapturederror = $isCallable(value) ? value : null;
    if (this.#onuncapturederror) this.addEventListener("uncapturederror", this.#onuncapturederror as EventListener);
  }

  destroy() {
    this.#handle.destroy();
  }

  createBuffer(descriptor) {
    return this.#handle.createBuffer(descriptor);
  }
  createTexture(descriptor) {
    return this.#handle.createTexture(descriptor);
  }
  createSampler(descriptor) {
    return this.#handle.createSampler(descriptor);
  }
  createBindGroupLayout(descriptor) {
    return this.#handle.createBindGroupLayout(descriptor);
  }
  createPipelineLayout(descriptor) {
    return this.#handle.createPipelineLayout(descriptor);
  }
  createBindGroup(descriptor) {
    return this.#handle.createBindGroup(descriptor);
  }
  createShaderModule(descriptor) {
    return this.#handle.createShaderModule(descriptor);
  }
  createComputePipeline(descriptor) {
    return this.#handle.createComputePipeline(descriptor);
  }
  createRenderPipeline(descriptor) {
    return this.#handle.createRenderPipeline(descriptor);
  }
  async createComputePipelineAsync(descriptor) {
    try {
      return await this.#handle.createComputePipelineAsync(descriptor);
    } catch (error) {
      rethrowPipelineError(error);
    }
  }
  async createRenderPipelineAsync(descriptor) {
    try {
      return await this.#handle.createRenderPipelineAsync(descriptor);
    } catch (error) {
      rethrowPipelineError(error);
    }
  }
  createCommandEncoder(descriptor) {
    return this.#handle.createCommandEncoder(descriptor);
  }
  createRenderBundleEncoder(descriptor) {
    return this.#handle.createRenderBundleEncoder(descriptor);
  }
  createQuerySet(descriptor) {
    return this.#handle.createQuerySet(descriptor);
  }

  pushErrorScope(filter) {
    this.#handle.pushErrorScope(filter);
  }
  async popErrorScope() {
    const error: [number, string] | null = await this.#handle.popErrorScope();
    return error === null ? null : makeError(error[0], error[1]);
  }
}

// The native side rejects with a `[reason, message]` pair; anything else (a
// TypeError from descriptor conversion) passes through.
function rethrowPipelineError(error: unknown): never {
  if ($isJSArray(error)) {
    const [reason, message] = error as [string, string];
    throw new GPUPipelineError(message, { reason: reason as "validation" | "internal" });
  }
  throw error;
}

const GPUBufferUsage = Object.freeze({
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
});

const GPUMapMode = Object.freeze({
  READ: 0x0001,
  WRITE: 0x0002,
});

const GPUTextureUsage = Object.freeze({
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
});

const GPUShaderStage = Object.freeze({
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
});

const GPUColorWrite = Object.freeze({
  RED: 0x1,
  GREEN: 0x2,
  BLUE: 0x4,
  ALPHA: 0x8,
  ALL: 0xf,
});

export default {
  // globals
  GPUSupportedFeatures,
  WGSLLanguageFeatures,
  GPUSupportedLimits,
  GPUAdapterInfo,
  GPUDeviceLostInfo,
  GPUCompilationMessage,
  GPUCompilationInfo,
  GPUError,
  GPUValidationError,
  GPUOutOfMemoryError,
  GPUInternalError,
  GPUPipelineError,
  GPUUncapturedErrorEvent,
  GPUDevice,
  GPUBufferUsage,
  GPUMapMode,
  GPUTextureUsage,
  GPUShaderStage,
  GPUColorWrite,

  // called from src/runtime/webgpu/
  createSupportedFeatures: (names: string[]) => new GPUSupportedFeatures(kConstruct, names),
  createWGSLLanguageFeatures: (names: string[]) => new WGSLLanguageFeatures(kConstruct, names),
  createSupportedLimits: (limits: Limits) => new GPUSupportedLimits(kConstruct, limits),
  createAdapterInfo: (info: AdapterInfo) => new GPUAdapterInfo(kConstruct, info),
  createDeviceLostInfo: (reason: "unknown" | "destroyed", message: string) =>
    new GPUDeviceLostInfo(kConstruct, reason, message),
  createCompilationInfo: (messages: CompilationMessage[]) => new GPUCompilationInfo(kConstruct, messages),
  createDevice: (handle: DeviceHandle) => new GPUDevice(kConstruct, handle),
};
