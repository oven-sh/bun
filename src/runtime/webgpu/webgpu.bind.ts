/**
 * WebGPU (https://gpuweb.github.io/gpuweb/), in the order of its IDL, without what needs a window or a DOM: canvases,
 * importing external textures and images, XR. Only in a build with `--webgpu=on`.
 */
import * as b from "../../codegen/bindgen-lib.ts";
import type { Type } from "../../codegen/bindgen-lib-internal.ts";

export default b.module({ rustPath: "crate::webgpu" });

// ───────────────────────────── typedefs ─────────────────────────────

const GPUSize64 = b.u64.enforceRange();
const GPUSize32 = b.u32.enforceRange();
const GPUIndex32 = GPUSize32;
const GPUIntegerCoordinate = GPUSize32;
const GPUBufferDynamicOffset = GPUSize32;
const GPUStencilValue = GPUSize32;
const GPUSampleMask = GPUSize32;
const GPUFlags = GPUSize32;
const GPUSignedOffset32 = b.i32.enforceRange();
const GPUDepthBias = GPUSignedOffset32;
const double = b.f64.loose.finite;
const boolean = b.bool.loose;
const DOMString = b.string.loose;
const USVString = b.string.usv;
/** For what Dawn takes and nothing keeps. An unpaired surrogate becomes U+FFFD, as in a `USVString`. */
const utf8 = b.string.loose.utf8;
const promise = b.any.returning("Promise");

type Members = Record<string, Type>;

/** WebIDL reads the members of a dictionary in lexicographical order, after those of the dictionary it inherits from. */
function dictionary(...levels: Members[]) {
  const inOrder = levels.flatMap(level => Object.entries(level).sort(([a], [b]) => (a < b ? -1 : 1)));
  return b.dictionary(Object.fromEntries(inOrder));
}

const GPUObjectDescriptorBase = { label: USVString.default("") };
const GPUObjectBase = { label: { getter: USVString, setter: true } } as const;

const rustPath = (name: string) => `crate::webgpu::${name}`;
/** The attributes and the operations of a WebIDL interface can be replaced, which shims and debuggers do. */
const webIDL = { configurable: true } as const;
/** An interface that JavaScript names and does not construct. */
const webInterface = { ...webIDL, construct: "illegal" } as const;
/** One whose struct a descriptor can hold. */
const gpuObject = { ...webInterface, refCounted: true } as const;

const setIterator = b.any.returning("object");
/** `readonly setlike<DOMString>`. */
const setlike = {
  size: { getter: b.u32 },
  has: { args: { value: DOMString }, returns: b.bool },
  entries: { returns: setIterator, capability: "heap", passThis: true },
  keys: { returns: setIterator, capability: "heap", passThis: true },
  values: { returns: setIterator, capability: "heap", passThis: true },
  forEach: {
    args: { callback: b.callable, thisArg: b.any },
    capability: "js",
    throws: true,
    passThis: true,
    length: 1,
  },
  "@@iterator": { returns: setIterator, capability: "heap", passThis: true, rustName: "values" },
} as const;

// ───────────────────────────── features, limits, adapter info ─────────────────────────────

export const GPUFeatureName = b.enumeration([
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "timestamp-query",
  "indirect-first-instance",
  "shader-f16",
  "rg11b10ufloat-renderable",
  "bgra8unorm-storage",
  "float32-filterable",
  "float32-blendable",
  "clip-distances",
  "dual-source-blending",
  "subgroups",
  "texture-formats-tier1",
  "texture-formats-tier2",
  "primitive-index",
  "texture-component-swizzle",
  "subgroup-size-control",
  "texture-compression-unaligned",
  "atomic-vec2u-min-max",
]);

const limit32 = { getter: b.u32 };
const limit64 = { getter: b.u64 };
export const GPUSupportedLimits = b.class({
  rustPath: rustPath("GPUSupportedLimits"),
  ...webInterface,
  proto: {
    maxTextureDimension1D: limit32,
    maxTextureDimension2D: limit32,
    maxTextureDimension3D: limit32,
    maxTextureArrayLayers: limit32,
    maxBindGroups: limit32,
    maxBindGroupsPlusVertexBuffers: limit32,
    maxImmediateSize: limit32,
    maxBindingsPerBindGroup: limit32,
    maxDynamicUniformBuffersPerPipelineLayout: limit32,
    maxDynamicStorageBuffersPerPipelineLayout: limit32,
    maxSampledTexturesPerShaderStage: limit32,
    maxSamplersPerShaderStage: limit32,
    maxStorageBuffersPerShaderStage: limit32,
    maxStorageBuffersInVertexStage: limit32,
    maxStorageBuffersInFragmentStage: limit32,
    maxStorageTexturesPerShaderStage: limit32,
    maxStorageTexturesInVertexStage: limit32,
    maxStorageTexturesInFragmentStage: limit32,
    maxUniformBuffersPerShaderStage: limit32,
    maxUniformBufferBindingSize: limit64,
    maxStorageBufferBindingSize: limit64,
    minUniformBufferOffsetAlignment: limit32,
    minStorageBufferOffsetAlignment: limit32,
    maxVertexBuffers: limit32,
    maxBufferSize: limit64,
    maxVertexAttributes: limit32,
    maxVertexBufferArrayStride: limit32,
    maxInterStageShaderVariables: limit32,
    maxColorAttachments: limit32,
    maxColorAttachmentBytesPerSample: limit32,
    maxComputeWorkgroupStorageSize: limit32,
    maxComputeInvocationsPerWorkgroup: limit32,
    maxComputeWorkgroupSizeX: limit32,
    maxComputeWorkgroupSizeY: limit32,
    maxComputeWorkgroupSizeZ: limit32,
    maxComputeWorkgroupsPerDimension: limit32,
  },
});

export const GPUSupportedFeatures = b.class({
  rustPath: rustPath("GPUSupportedFeatures"),
  ...webInterface,
  internalFields: ["set"],
  proto: setlike,
});

export const WGSLLanguageFeatures = b.class({
  rustPath: rustPath("WGSLLanguageFeatures"),
  ...webInterface,
  internalFields: ["set"],
  proto: setlike,
});

export const GPUAdapterInfo = b.class({
  rustPath: rustPath("GPUAdapterInfo"),
  ...webInterface,
  proto: {
    vendor: { getter: b.string },
    architecture: { getter: b.string },
    device: { getter: b.string },
    description: { getter: b.string },
    subgroupMinSize: { getter: b.u32 },
    subgroupMaxSize: { getter: b.u32 },
    isFallbackAdapter: { getter: b.bool },
  },
});

// ───────────────────────────── enumerations that a class below returns ─────────────────────────────

export const GPUBufferMapState = b.enumeration(["unmapped", "pending", "mapped"]);
export const GPUTextureDimension = b.enumeration({ D1: "1d", D2: "2d", D3: "3d" });
export const GPUTextureViewDimension = b.enumeration({
  D1: "1d",
  D2: "2d",
  D2Array: "2d-array",
  Cube: "cube",
  CubeArray: "cube-array",
  D3: "3d",
});
export const GPUTextureAspect = b.enumeration(["all", "stencil-only", "depth-only"]);
export const GPUTextureFormat = b.enumeration([
  "r8unorm",
  "r8snorm",
  "r8uint",
  "r8sint",
  "r16unorm",
  "r16snorm",
  "r16uint",
  "r16sint",
  "r16float",
  "rg8unorm",
  "rg8snorm",
  "rg8uint",
  "rg8sint",
  "r32uint",
  "r32sint",
  "r32float",
  "rg16unorm",
  "rg16snorm",
  "rg16uint",
  "rg16sint",
  "rg16float",
  "rgba8unorm",
  "rgba8unorm-srgb",
  "rgba8snorm",
  "rgba8uint",
  "rgba8sint",
  "bgra8unorm",
  "bgra8unorm-srgb",
  "rgb9e5ufloat",
  "rgb10a2uint",
  "rgb10a2unorm",
  "rg11b10ufloat",
  "rg32uint",
  "rg32sint",
  "rg32float",
  "rgba16unorm",
  "rgba16snorm",
  "rgba16uint",
  "rgba16sint",
  "rgba16float",
  "rgba32uint",
  "rgba32sint",
  "rgba32float",
  "stencil8",
  "depth16unorm",
  "depth24plus",
  "depth24plus-stencil8",
  "depth32float",
  "depth32float-stencil8",
  "bc1-rgba-unorm",
  "bc1-rgba-unorm-srgb",
  "bc2-rgba-unorm",
  "bc2-rgba-unorm-srgb",
  "bc3-rgba-unorm",
  "bc3-rgba-unorm-srgb",
  "bc4-r-unorm",
  "bc4-r-snorm",
  "bc5-rg-unorm",
  "bc5-rg-snorm",
  "bc6h-rgb-ufloat",
  "bc6h-rgb-float",
  "bc7-rgba-unorm",
  "bc7-rgba-unorm-srgb",
  "etc2-rgb8unorm",
  "etc2-rgb8unorm-srgb",
  "etc2-rgb8a1unorm",
  "etc2-rgb8a1unorm-srgb",
  "etc2-rgba8unorm",
  "etc2-rgba8unorm-srgb",
  "eac-r11unorm",
  "eac-r11snorm",
  "eac-rg11unorm",
  "eac-rg11snorm",
  "astc-4x4-unorm",
  "astc-4x4-unorm-srgb",
  "astc-5x4-unorm",
  "astc-5x4-unorm-srgb",
  "astc-5x5-unorm",
  "astc-5x5-unorm-srgb",
  "astc-6x5-unorm",
  "astc-6x5-unorm-srgb",
  "astc-6x6-unorm",
  "astc-6x6-unorm-srgb",
  "astc-8x5-unorm",
  "astc-8x5-unorm-srgb",
  "astc-8x6-unorm",
  "astc-8x6-unorm-srgb",
  "astc-8x8-unorm",
  "astc-8x8-unorm-srgb",
  "astc-10x5-unorm",
  "astc-10x5-unorm-srgb",
  "astc-10x6-unorm",
  "astc-10x6-unorm-srgb",
  "astc-10x8-unorm",
  "astc-10x8-unorm-srgb",
  "astc-10x10-unorm",
  "astc-10x10-unorm-srgb",
  "astc-12x10-unorm",
  "astc-12x10-unorm-srgb",
  "astc-12x12-unorm",
  "astc-12x12-unorm-srgb",
]);
export const GPUQueryType = b.enumeration(["occlusion", "timestamp"]);
export const GPUCompilationMessageType = b.enumeration(["error", "warning", "info"]);
export const GPUDeviceLostReason = b.enumeration(["unknown", "destroyed"]);
export const GPUErrorFilter = b.enumeration(["validation", "out-of-memory", "internal"]);

// ───────────────────────────── colors, origins, extents ─────────────────────────────

export const GPUColorDict = dictionary({ r: double, g: double, b: double, a: double });
export const GPUColor = b.union({ sequence: b.sequence(double), dict: GPUColorDict });
export const GPUOrigin3DDict = dictionary({
  x: GPUIntegerCoordinate.default(0),
  y: GPUIntegerCoordinate.default(0),
  z: GPUIntegerCoordinate.default(0),
});
export const GPUOrigin3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dict: GPUOrigin3DDict });
export const GPUExtent3DDict = dictionary({
  width: GPUIntegerCoordinate,
  height: GPUIntegerCoordinate.default(1),
  depthOrArrayLayers: GPUIntegerCoordinate.default(1),
});
export const GPUExtent3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dict: GPUExtent3DDict });

// ───────────────────────────── buffers ─────────────────────────────

export const GPUBuffer = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUBuffer"),
  estimatedSize: true,
  proto: {
    ...GPUObjectBase,
    size: { getter: b.u64 },
    usage: { getter: b.u32 },
    mapState: { getter: GPUBufferMapState },
    mapAsync: {
      args: { mode: GPUFlags, offset: GPUSize64.default(0), size: GPUSize64.optional },
      returns: promise,
      capability: "js",
      throws: true,
      rejects: true,
    },
    getMappedRange: {
      args: { offset: GPUSize64.default(0), size: GPUSize64.optional },
      returns: b.any.returning("ArrayBuffer"),
      capability: "heap",
      throws: true,
    },
    unmap: { capability: "js", throws: true },
    destroy: { capability: "js", throws: true },
  },
});

export const GPUBufferDescriptor = dictionary(GPUObjectDescriptorBase, {
  size: GPUSize64,
  usage: GPUFlags,
  mappedAtCreation: boolean.default(false),
});

export const GPUBufferUsage = b.namespace(
  {
    MAP_READ: { constant: 0x0001 },
    MAP_WRITE: { constant: 0x0002 },
    COPY_SRC: { constant: 0x0004 },
    COPY_DST: { constant: 0x0008 },
    INDEX: { constant: 0x0010 },
    VERTEX: { constant: 0x0020 },
    UNIFORM: { constant: 0x0040 },
    STORAGE: { constant: 0x0080 },
    INDIRECT: { constant: 0x0100 },
    QUERY_RESOLVE: { constant: 0x0200 },
  },
  { toStringTag: true },
);

export const GPUMapMode = b.namespace(
  { READ: { constant: 0x0001 }, WRITE: { constant: 0x0002 } },
  { toStringTag: true },
);

// ───────────────────────────── textures ─────────────────────────────

export const GPUTextureView = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUTextureView"),
  proto: GPUObjectBase,
});

export const GPUTextureViewDescriptor = dictionary(GPUObjectDescriptorBase, {
  format: GPUTextureFormat.optional,
  dimension: GPUTextureViewDimension.optional,
  usage: GPUFlags.default(0),
  aspect: GPUTextureAspect.default("all"),
  baseMipLevel: GPUIntegerCoordinate.default(0),
  mipLevelCount: GPUIntegerCoordinate.optional,
  baseArrayLayer: GPUIntegerCoordinate.default(0),
  arrayLayerCount: GPUIntegerCoordinate.optional,
  swizzle: utf8.default("rgba"),
});

export const GPUTexture = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUTexture"),
  estimatedSize: true,
  proto: {
    ...GPUObjectBase,
    createView: {
      args: { descriptor: GPUTextureViewDescriptor.nullable.default({}) },
      returns: GPUTextureView,
      capability: "heap",
      throws: true,
    },
    destroy: {},
    width: { getter: b.u32 },
    height: { getter: b.u32 },
    depthOrArrayLayers: { getter: b.u32 },
    mipLevelCount: { getter: b.u32 },
    sampleCount: { getter: b.u32 },
    dimension: { getter: GPUTextureDimension },
    format: { getter: GPUTextureFormat },
    usage: { getter: b.u32 },
    textureBindingViewDimension: { getter: GPUTextureViewDimension.optional },
  },
});

export const GPUTextureDescriptor = dictionary(GPUObjectDescriptorBase, {
  size: GPUExtent3D,
  mipLevelCount: GPUIntegerCoordinate.default(1),
  sampleCount: GPUSize32.default(1),
  dimension: GPUTextureDimension.default("2d"),
  format: GPUTextureFormat,
  usage: GPUFlags,
  viewFormats: b.sequence(GPUTextureFormat).default([]),
  textureBindingViewDimension: GPUTextureViewDimension.optional,
});

export const GPUTextureUsage = b.namespace(
  {
    COPY_SRC: { constant: 0x01 },
    COPY_DST: { constant: 0x02 },
    TEXTURE_BINDING: { constant: 0x04 },
    STORAGE_BINDING: { constant: 0x08 },
    RENDER_ATTACHMENT: { constant: 0x10 },
    TRANSIENT_ATTACHMENT: { constant: 0x20 },
  },
  { toStringTag: true },
);

// ───────────────────────────── samplers ─────────────────────────────

export const GPUSampler = b.class({ ...gpuObject, rustPath: rustPath("GPUSampler"), proto: GPUObjectBase });

export const GPUAddressMode = b.enumeration(["clamp-to-edge", "repeat", "mirror-repeat"]);
export const GPUFilterMode = b.enumeration(["nearest", "linear"]);
export const GPUMipmapFilterMode = b.enumeration(["nearest", "linear"]);
export const GPUCompareFunction = b.enumeration([
  "never",
  "less",
  "equal",
  "less-equal",
  "greater",
  "not-equal",
  "greater-equal",
  "always",
]);

export const GPUSamplerDescriptor = dictionary(GPUObjectDescriptorBase, {
  addressModeU: GPUAddressMode.default("clamp-to-edge"),
  addressModeV: GPUAddressMode.default("clamp-to-edge"),
  addressModeW: GPUAddressMode.default("clamp-to-edge"),
  magFilter: GPUFilterMode.default("nearest"),
  minFilter: GPUFilterMode.default("nearest"),
  mipmapFilter: GPUMipmapFilterMode.default("nearest"),
  lodMinClamp: b.f32.default(0),
  lodMaxClamp: b.f32.default(32),
  compare: GPUCompareFunction.optional,
  maxAnisotropy: b.u16.clamp.default(1),
});

// ───────────────────────────── bind groups ─────────────────────────────

export const GPUBindGroupLayout = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUBindGroupLayout"),
  proto: GPUObjectBase,
});

export const GPUShaderStage = b.namespace(
  { VERTEX: { constant: 0x1 }, FRAGMENT: { constant: 0x2 }, COMPUTE: { constant: 0x4 } },
  { toStringTag: true },
);

export const GPUBufferBindingType = b.enumeration(["uniform", "storage", "read-only-storage"]);
export const GPUBufferBindingLayout = dictionary({
  type: GPUBufferBindingType.default("uniform"),
  hasDynamicOffset: boolean.default(false),
  minBindingSize: GPUSize64.default(0),
});
export const GPUSamplerBindingType = b.enumeration(["filtering", "non-filtering", "comparison"]);
export const GPUSamplerBindingLayout = dictionary({ type: GPUSamplerBindingType.default("filtering") });
export const GPUTextureSampleType = b.enumeration(["float", "unfilterable-float", "depth", "sint", "uint"]);
export const GPUTextureBindingLayout = dictionary({
  sampleType: GPUTextureSampleType.default("float"),
  viewDimension: GPUTextureViewDimension.default("2d"),
  multisampled: boolean.default(false),
});
export const GPUStorageTextureAccess = b.enumeration(["write-only", "read-only", "read-write"]);
export const GPUStorageTextureBindingLayout = dictionary({
  access: GPUStorageTextureAccess.default("write-only"),
  format: GPUTextureFormat,
  viewDimension: GPUTextureViewDimension.default("2d"),
});
export const GPUExternalTextureBindingLayout = dictionary({});
export const GPUBindGroupLayoutEntry = dictionary({
  binding: GPUIndex32,
  visibility: GPUFlags,
  buffer: GPUBufferBindingLayout.optional,
  sampler: GPUSamplerBindingLayout.optional,
  texture: GPUTextureBindingLayout.optional,
  storageTexture: GPUStorageTextureBindingLayout.optional,
  externalTexture: GPUExternalTextureBindingLayout.optional,
});
export const GPUBindGroupLayoutDescriptor = dictionary(GPUObjectDescriptorBase, {
  entries: b.sequence(GPUBindGroupLayoutEntry),
});

export const GPUBindGroup = b.class({ ...gpuObject, rustPath: rustPath("GPUBindGroup"), proto: GPUObjectBase });

/** Nothing makes one: it is imported from a video. `instanceof` needs the interface, and a view binds where one would. */
export const GPUExternalTexture = b.class({
  ...webInterface,
  rustPath: rustPath("GPUExternalTexture"),
  proto: GPUObjectBase,
});

export const GPUBufferBinding = dictionary({
  buffer: GPUBuffer.ref,
  offset: GPUSize64.default(0),
  size: GPUSize64.optional,
});
export const GPUBindingResource = b.union({
  sampler: GPUSampler.ref,
  texture: GPUTexture.ref,
  textureView: GPUTextureView.ref,
  buffer: GPUBuffer.ref,
  bufferBinding: GPUBufferBinding,
});
export const GPUBindGroupEntry = dictionary({ binding: GPUIndex32, resource: GPUBindingResource });
export const GPUBindGroupDescriptor = dictionary(GPUObjectDescriptorBase, {
  layout: GPUBindGroupLayout.ref,
  entries: b.sequence(GPUBindGroupEntry),
});

export const GPUPipelineLayout = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUPipelineLayout"),
  proto: GPUObjectBase,
});
export const GPUPipelineLayoutDescriptor = dictionary(GPUObjectDescriptorBase, {
  bindGroupLayouts: b.sequence(GPUBindGroupLayout.ref.nullable),
  immediateSize: GPUSize32.default(0),
});

// ───────────────────────────── shader modules ─────────────────────────────

export const GPUCompilationMessage = b.class({
  rustPath: rustPath("GPUCompilationMessage"),
  ...webInterface,
  proto: {
    message: { getter: b.string },
    type: { getter: GPUCompilationMessageType },
    lineNum: { getter: b.u64 },
    linePos: { getter: b.u64 },
    offset: { getter: b.u64 },
    length: { getter: b.u64 },
  },
});

export const GPUCompilationInfo = b.class({
  rustPath: rustPath("GPUCompilationInfo"),
  ...webInterface,
  internalFields: ["messages"],
  /** A `FrozenArray`. */
  proto: { messages: { internalField: "messages" } },
});

export const GPUShaderModule = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUShaderModule"),
  proto: {
    ...GPUObjectBase,
    getCompilationInfo: { returns: promise, capability: "js", throws: true, rejects: true },
  },
});

export const GPUAutoLayoutMode = b.enumeration(["auto"]);
export const GPUPipelineLayoutOrAuto = b.union({ layout: GPUPipelineLayout.ref, automatic: GPUAutoLayoutMode });

export const GPUShaderModuleCompilationHint = dictionary({
  entryPoint: USVString,
  layout: GPUPipelineLayoutOrAuto.optional,
});
export const GPUShaderModuleDescriptor = dictionary(GPUObjectDescriptorBase, {
  code: utf8,
  compilationHints: b.sequence(GPUShaderModuleCompilationHint).default([]),
});

// ───────────────────────────── pipelines ─────────────────────────────

const GPUPipelineDescriptorBase = { layout: GPUPipelineLayoutOrAuto };
const GPUPipelineBase = {
  getBindGroupLayout: { args: { index: b.u32.wrap }, returns: GPUBindGroupLayout, capability: "heap" },
} as const;

const GPUProgrammableStageMembers = {
  module: GPUShaderModule.ref,
  entryPoint: utf8.optional,
  constants: b.record(double).default({}),
};
export const GPUProgrammableStage = dictionary(GPUProgrammableStageMembers);

export const GPUComputePipeline = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUComputePipeline"),
  proto: { ...GPUObjectBase, ...GPUPipelineBase },
});
export const GPUComputePipelineDescriptor = dictionary(GPUObjectDescriptorBase, GPUPipelineDescriptorBase, {
  compute: GPUProgrammableStage,
});

export const GPURenderPipeline = b.class({
  ...gpuObject,
  rustPath: rustPath("GPURenderPipeline"),
  proto: { ...GPUObjectBase, ...GPUPipelineBase },
});

export const GPUPrimitiveTopology = b.enumeration([
  "point-list",
  "line-list",
  "line-strip",
  "triangle-list",
  "triangle-strip",
]);
export const GPUFrontFace = b.enumeration(["ccw", "cw"]);
export const GPUCullMode = b.enumeration(["none", "front", "back"]);
export const GPUIndexFormat = b.enumeration(["uint16", "uint32"]);
export const GPUPrimitiveState = dictionary({
  topology: GPUPrimitiveTopology.default("triangle-list"),
  stripIndexFormat: GPUIndexFormat.optional,
  frontFace: GPUFrontFace.default("ccw"),
  cullMode: GPUCullMode.default("none"),
  unclippedDepth: boolean.default(false),
});
export const GPUMultisampleState = dictionary({
  count: GPUSize32.default(1),
  mask: GPUSampleMask.default(0xffffffff),
  alphaToCoverageEnabled: boolean.default(false),
});

export const GPUColorWrite = b.namespace(
  {
    RED: { constant: 0x1 },
    GREEN: { constant: 0x2 },
    BLUE: { constant: 0x4 },
    ALPHA: { constant: 0x8 },
    ALL: { constant: 0xf },
  },
  { toStringTag: true },
);
export const GPUBlendFactor = b.enumeration([
  "zero",
  "one",
  "src",
  "one-minus-src",
  "src-alpha",
  "one-minus-src-alpha",
  "dst",
  "one-minus-dst",
  "dst-alpha",
  "one-minus-dst-alpha",
  "src-alpha-saturated",
  "constant",
  "one-minus-constant",
  "src1",
  "one-minus-src1",
  "src1-alpha",
  "one-minus-src1-alpha",
]);
export const GPUBlendOperation = b.enumeration(["add", "subtract", "reverse-subtract", "min", "max"]);
export const GPUBlendComponent = dictionary({
  operation: GPUBlendOperation.default("add"),
  srcFactor: GPUBlendFactor.default("one"),
  dstFactor: GPUBlendFactor.default("zero"),
});
export const GPUBlendState = dictionary({ color: GPUBlendComponent, alpha: GPUBlendComponent });
export const GPUColorTargetState = dictionary({
  format: GPUTextureFormat,
  blend: GPUBlendState.optional,
  writeMask: GPUFlags.default(0xf),
});
export const GPUFragmentState = dictionary(GPUProgrammableStageMembers, {
  targets: b.sequence(GPUColorTargetState.nullable),
});

export const GPUStencilOperation = b.enumeration([
  "keep",
  "zero",
  "replace",
  "invert",
  "increment-clamp",
  "decrement-clamp",
  "increment-wrap",
  "decrement-wrap",
]);
export const GPUStencilFaceState = dictionary({
  compare: GPUCompareFunction.default("always"),
  failOp: GPUStencilOperation.default("keep"),
  depthFailOp: GPUStencilOperation.default("keep"),
  passOp: GPUStencilOperation.default("keep"),
});
export const GPUDepthStencilState = dictionary({
  format: GPUTextureFormat,
  depthWriteEnabled: boolean.optional,
  depthCompare: GPUCompareFunction.optional,
  stencilFront: GPUStencilFaceState.nullable.default({}),
  stencilBack: GPUStencilFaceState.nullable.default({}),
  stencilReadMask: GPUStencilValue.default(0xffffffff),
  stencilWriteMask: GPUStencilValue.default(0xffffffff),
  depthBias: GPUDepthBias.default(0),
  depthBiasSlopeScale: b.f32.default(0),
  depthBiasClamp: b.f32.default(0),
});

export const GPUVertexFormat = b.enumeration([
  "uint8",
  "uint8x2",
  "uint8x4",
  "sint8",
  "sint8x2",
  "sint8x4",
  "unorm8",
  "unorm8x2",
  "unorm8x4",
  "snorm8",
  "snorm8x2",
  "snorm8x4",
  "uint16",
  "uint16x2",
  "uint16x4",
  "sint16",
  "sint16x2",
  "sint16x4",
  "unorm16",
  "unorm16x2",
  "unorm16x4",
  "snorm16",
  "snorm16x2",
  "snorm16x4",
  "float16",
  "float16x2",
  "float16x4",
  "float32",
  "float32x2",
  "float32x3",
  "float32x4",
  "uint32",
  "uint32x2",
  "uint32x3",
  "uint32x4",
  "sint32",
  "sint32x2",
  "sint32x3",
  "sint32x4",
  "unorm10-10-10-2",
  "unorm8x4-bgra",
  "snorm10-10-10-2",
]);
export const GPUVertexStepMode = b.enumeration(["vertex", "instance"]);
export const GPUVertexAttribute = dictionary({
  format: GPUVertexFormat,
  offset: GPUSize64,
  shaderLocation: GPUIndex32,
});
export const GPUVertexBufferLayout = dictionary({
  arrayStride: GPUSize64,
  stepMode: GPUVertexStepMode.default("vertex"),
  attributes: b.sequence(GPUVertexAttribute),
});
export const GPUVertexState = dictionary(GPUProgrammableStageMembers, {
  buffers: b.sequence(GPUVertexBufferLayout.nullable).default([]),
});

export const GPURenderPipelineDescriptor = dictionary(GPUObjectDescriptorBase, GPUPipelineDescriptorBase, {
  vertex: GPUVertexState,
  primitive: GPUPrimitiveState.nullable.default({}),
  depthStencil: GPUDepthStencilState.optional,
  multisample: GPUMultisampleState.nullable.default({}),
  fragment: GPUFragmentState.optional,
});

// ───────────────────────────── copies ─────────────────────────────

const GPUTexelCopyBufferLayoutMembers = {
  offset: GPUSize64.default(0),
  bytesPerRow: GPUSize32.optional,
  rowsPerImage: GPUSize32.optional,
};
export const GPUTexelCopyBufferLayout = dictionary(GPUTexelCopyBufferLayoutMembers);
export const GPUTexelCopyBufferInfo = dictionary(GPUTexelCopyBufferLayoutMembers, { buffer: GPUBuffer.ref });
export const GPUTexelCopyTextureInfo = dictionary({
  texture: GPUTexture.ref,
  mipLevel: GPUIntegerCoordinate.default(0),
  origin: GPUOrigin3D.optional,
  aspect: GPUTextureAspect.default("all"),
});

// ───────────────────────────── query sets ─────────────────────────────

export const GPUQuerySet = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUQuerySet"),
  proto: {
    ...GPUObjectBase,
    destroy: {},
    type: { getter: GPUQueryType },
    count: { getter: b.u32 },
  },
});
export const GPUQuerySetDescriptor = dictionary(GPUObjectDescriptorBase, { type: GPUQueryType, count: GPUSize32 });

// ───────────────────────────── command encoding ─────────────────────────────

export const GPUCommandBuffer = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUCommandBuffer"),
  proto: GPUObjectBase,
});
export const GPUCommandBufferDescriptor = dictionary(GPUObjectDescriptorBase);
export const GPUCommandEncoderDescriptor = dictionary(GPUObjectDescriptorBase);

const GPUDebugCommandsMixin = {
  pushDebugGroup: { args: { groupLabel: utf8 } },
  popDebugGroup: {},
  insertDebugMarker: { args: { markerLabel: utf8 } },
} as const;

const GPUBindingCommandsMixin = {
  setBindGroup: [
    {
      rustName: "set_bind_group",
      args: {
        index: GPUIndex32,
        bindGroup: GPUBindGroup.nullable,
        dynamicOffsets: b.sequence(GPUBufferDynamicOffset).default([]),
      },
    },
    {
      rustName: "set_bind_group_with_data",
      args: {
        index: GPUIndex32,
        bindGroup: GPUBindGroup.nullable,
        dynamicOffsetsData: b.bufferSource.allowShared,
        dynamicOffsetsDataStart: GPUSize64,
        dynamicOffsetsDataLength: GPUSize32,
      },
      capability: "heap",
      throws: true,
    },
  ],
  setImmediates: {
    args: {
      rangeOffset: GPUSize32,
      data: b.bufferSource.allowShared,
      dataOffset: GPUSize64.default(0),
      dataSize: GPUSize64.optional,
    },
    capability: "heap",
    throws: true,
  },
} as const;

export const GPUComputePassEncoder = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUComputePassEncoder"),
  proto: {
    ...GPUObjectBase,
    setPipeline: { args: { pipeline: GPUComputePipeline } },
    dispatchWorkgroups: {
      args: {
        workgroupCountX: GPUSize32,
        workgroupCountY: GPUSize32.default(1),
        workgroupCountZ: GPUSize32.default(1),
      },
    },
    dispatchWorkgroupsIndirect: { args: { indirectBuffer: GPUBuffer, indirectOffset: GPUSize64 } },
    end: {},
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
  },
});

const timestampWrites = {
  querySet: GPUQuerySet.ref,
  beginningOfPassWriteIndex: GPUSize32.optional,
  endOfPassWriteIndex: GPUSize32.optional,
};
export const GPUComputePassTimestampWrites = dictionary(timestampWrites);
export const GPUComputePassDescriptor = dictionary(GPUObjectDescriptorBase, {
  timestampWrites: GPUComputePassTimestampWrites.optional,
});

export const GPURenderBundle = b.class({ ...gpuObject, rustPath: rustPath("GPURenderBundle"), proto: GPUObjectBase });
export const GPURenderBundleDescriptor = dictionary(GPUObjectDescriptorBase);

const GPURenderCommandsMixin = {
  setPipeline: { args: { pipeline: GPURenderPipeline } },
  setIndexBuffer: {
    args: { buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset: GPUSize64.default(0), size: GPUSize64.optional },
  },
  setVertexBuffer: {
    args: { slot: GPUIndex32, buffer: GPUBuffer.nullable, offset: GPUSize64.default(0), size: GPUSize64.optional },
  },
  draw: {
    args: {
      vertexCount: GPUSize32,
      instanceCount: GPUSize32.default(1),
      firstVertex: GPUSize32.default(0),
      firstInstance: GPUSize32.default(0),
    },
  },
  drawIndexed: {
    args: {
      indexCount: GPUSize32,
      instanceCount: GPUSize32.default(1),
      firstIndex: GPUSize32.default(0),
      baseVertex: GPUSignedOffset32.default(0),
      firstInstance: GPUSize32.default(0),
    },
  },
  drawIndirect: { args: { indirectBuffer: GPUBuffer, indirectOffset: GPUSize64 } },
  drawIndexedIndirect: { args: { indirectBuffer: GPUBuffer, indirectOffset: GPUSize64 } },
} as const;

export const GPURenderPassEncoder = b.class({
  ...gpuObject,
  rustPath: rustPath("GPURenderPassEncoder"),
  proto: {
    ...GPUObjectBase,
    setViewport: {
      args: { x: b.f32, y: b.f32, width: b.f32, height: b.f32, minDepth: b.f32, maxDepth: b.f32 },
    },
    setScissorRect: {
      args: {
        x: GPUIntegerCoordinate,
        y: GPUIntegerCoordinate,
        width: GPUIntegerCoordinate,
        height: GPUIntegerCoordinate,
      },
    },
    setBlendConstant: { args: { color: GPUColor }, capability: "heap", throws: true },
    setStencilReference: { args: { reference: GPUStencilValue } },
    beginOcclusionQuery: { args: { queryIndex: GPUSize32 } },
    endOcclusionQuery: {},
    executeBundles: { args: { bundles: b.sequence(GPURenderBundle.ref) } },
    end: {},
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
    ...GPURenderCommandsMixin,
  },
});

export const GPULoadOp = b.enumeration(["load", "clear"]);
export const GPUStoreOp = b.enumeration(["store", "discard"]);
export const GPUTextureOrView = b.union({ texture: GPUTexture.ref, view: GPUTextureView.ref });
export const GPURenderPassTimestampWrites = dictionary(timestampWrites);
export const GPURenderPassColorAttachment = dictionary({
  view: GPUTextureOrView,
  depthSlice: GPUIntegerCoordinate.optional,
  resolveTarget: GPUTextureOrView.optional,
  clearValue: GPUColor.optional,
  loadOp: GPULoadOp,
  storeOp: GPUStoreOp,
});
export const GPURenderPassDepthStencilAttachment = dictionary({
  view: GPUTextureOrView,
  depthClearValue: b.f32.optional,
  depthLoadOp: GPULoadOp.optional,
  depthStoreOp: GPUStoreOp.optional,
  depthReadOnly: boolean.default(false),
  stencilClearValue: GPUStencilValue.default(0),
  stencilLoadOp: GPULoadOp.optional,
  stencilStoreOp: GPUStoreOp.optional,
  stencilReadOnly: boolean.default(false),
});
export const GPURenderPassDescriptor = dictionary(GPUObjectDescriptorBase, {
  colorAttachments: b.sequence(GPURenderPassColorAttachment.nullable),
  depthStencilAttachment: GPURenderPassDepthStencilAttachment.optional,
  occlusionQuerySet: GPUQuerySet.ref.optional,
  timestampWrites: GPURenderPassTimestampWrites.optional,
  maxDrawCount: GPUSize64.default(50000000),
});

const GPURenderPassLayout = {
  colorFormats: b.sequence(GPUTextureFormat.nullable),
  depthStencilFormat: GPUTextureFormat.optional,
  sampleCount: GPUSize32.default(1),
};
export const GPURenderBundleEncoderDescriptor = dictionary(GPUObjectDescriptorBase, GPURenderPassLayout, {
  depthReadOnly: boolean.default(false),
  stencilReadOnly: boolean.default(false),
});
export const GPURenderBundleEncoder = b.class({
  ...gpuObject,
  rustPath: rustPath("GPURenderBundleEncoder"),
  proto: {
    ...GPUObjectBase,
    finish: {
      args: { descriptor: GPURenderBundleDescriptor.nullable.default({}) },
      returns: GPURenderBundle,
      capability: "heap",
    },
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
    ...GPURenderCommandsMixin,
  },
});

export const GPUCommandEncoder = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUCommandEncoder"),
  proto: {
    ...GPUObjectBase,
    beginRenderPass: {
      args: { descriptor: GPURenderPassDescriptor },
      returns: GPURenderPassEncoder,
      capability: "heap",
      throws: true,
    },
    beginComputePass: {
      args: { descriptor: GPUComputePassDescriptor.nullable.default({}) },
      returns: GPUComputePassEncoder,
      capability: "heap",
    },
    copyBufferToBuffer: [
      {
        rustName: "copy_buffer_to_buffer",
        args: { source: GPUBuffer, destination: GPUBuffer, size: GPUSize64.optional },
      },
      {
        rustName: "copy_buffer_to_buffer_at",
        args: {
          source: GPUBuffer,
          sourceOffset: GPUSize64,
          destination: GPUBuffer,
          destinationOffset: GPUSize64,
          size: GPUSize64.optional,
        },
      },
    ],
    copyBufferToTexture: {
      args: { source: GPUTexelCopyBufferInfo, destination: GPUTexelCopyTextureInfo, copySize: GPUExtent3D },
      capability: "heap",
      throws: true,
    },
    copyTextureToBuffer: {
      args: { source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyBufferInfo, copySize: GPUExtent3D },
      capability: "heap",
      throws: true,
    },
    copyTextureToTexture: {
      args: { source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyTextureInfo, copySize: GPUExtent3D },
      capability: "heap",
      throws: true,
    },
    clearBuffer: { args: { buffer: GPUBuffer, offset: GPUSize64.default(0), size: GPUSize64.optional } },
    resolveQuerySet: {
      args: {
        querySet: GPUQuerySet,
        firstQuery: GPUSize32,
        queryCount: GPUSize32,
        destination: GPUBuffer,
        destinationOffset: GPUSize64,
      },
    },
    finish: {
      args: { descriptor: GPUCommandBufferDescriptor.nullable.default({}) },
      returns: GPUCommandBuffer,
      capability: "heap",
    },
    ...GPUDebugCommandsMixin,
  },
});

// ───────────────────────────── queues ─────────────────────────────

export const GPUQueueDescriptor = dictionary(GPUObjectDescriptorBase);
export const GPUQueue = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUQueue"),
  proto: {
    ...GPUObjectBase,
    submit: { args: { commandBuffers: b.sequence(GPUCommandBuffer.ref) } },
    onSubmittedWorkDone: { returns: promise, capability: "js", throws: true, rejects: true },
    writeBuffer: {
      args: {
        buffer: GPUBuffer,
        bufferOffset: GPUSize64,
        data: b.bufferSource.allowShared,
        dataOffset: GPUSize64.default(0),
        size: GPUSize64.optional,
      },
      capability: "heap",
      throws: true,
    },
    writeTexture: {
      args: {
        destination: GPUTexelCopyTextureInfo,
        data: b.bufferSource.allowShared,
        dataLayout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      },
      capability: "heap",
      throws: true,
    },
  },
});

// ───────────────────────────── errors ─────────────────────────────

export const GPUDeviceLostInfo = b.class({
  rustPath: rustPath("GPUDeviceLostInfo"),
  ...webInterface,
  proto: {
    reason: { getter: GPUDeviceLostReason },
    message: { getter: b.string },
  },
});

export const GPUError = b.class({
  ...webInterface,
  rustPath: rustPath("GPUError"),
  final: false,
  proto: { message: { getter: b.string } },
});
const errorConstructor = (rustName: string) => ({
  args: { message: DOMString.owned },
  requiredArguments: 1,
  rustName,
});
export const GPUValidationError = b.class({
  ...webIDL,
  extends: GPUError,
  construct: errorConstructor("new_validation_error"),
  proto: {},
});
export const GPUOutOfMemoryError = b.class({
  ...webIDL,
  extends: GPUError,
  construct: errorConstructor("new_out_of_memory_error"),
  proto: {},
});
export const GPUInternalError = b.class({
  ...webIDL,
  extends: GPUError,
  construct: errorConstructor("new_internal_error"),
  proto: {},
});

const EventInit = {
  bubbles: boolean.default(false),
  cancelable: boolean.default(false),
  composed: boolean.default(false),
};
/** `error` is a `GPUError`, which the event holds as the object that it is. */
export const GPUUncapturedErrorEventInit = dictionary(EventInit, { error: b.any });
export const GPUUncapturedErrorEvent = b.class({
  rustPath: rustPath("GPUUncapturedErrorEvent"),
  ...webIDL,
  refCounted: true,
  webcoreBase: "Event",
  construct: {
    args: { type: DOMString.owned, gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit },
    requiredArguments: 2,
    passStructure: true,
    capability: "heap",
    throws: true,
  },
  internalFields: ["error"],
  proto: { error: { internalField: "error" } },
});

export const GPUPipelineErrorReason = b.enumeration(["validation", "internal"]);
export const GPUPipelineErrorInit = dictionary({ reason: GPUPipelineErrorReason });
export const GPUPipelineError = b.class({
  rustPath: rustPath("GPUPipelineError"),
  ...webIDL,
  refCounted: true,
  webcoreBase: "DOMException",
  construct: { args: { message: DOMString.owned.default(""), options: GPUPipelineErrorInit } },
  proto: { reason: { getter: GPUPipelineErrorReason } },
});

// ───────────────────────────── devices ─────────────────────────────

export const GPUDevice = b.class({
  ...gpuObject,
  rustPath: rustPath("GPUDevice"),
  webcoreBase: "EventTarget",
  finalize: true,
  proto: {
    ...GPUObjectBase,
    features: { getter: GPUSupportedFeatures, cache: true, capability: "heap" },
    limits: { getter: GPUSupportedLimits, cache: true, capability: "heap" },
    adapterInfo: { getter: GPUAdapterInfo, cache: true, capability: "heap" },
    queue: { getter: GPUQueue, cache: true, capability: "heap" },
    destroy: { capability: "js", throws: true },
    createBuffer: {
      args: { descriptor: GPUBufferDescriptor },
      returns: GPUBuffer,
      capability: "heap",
      throws: true,
    },
    createTexture: {
      args: { descriptor: GPUTextureDescriptor },
      returns: GPUTexture,
      capability: "heap",
      throws: true,
    },
    createSampler: {
      args: { descriptor: GPUSamplerDescriptor.nullable.default({}) },
      returns: GPUSampler,
      capability: "heap",
    },
    createBindGroupLayout: {
      args: { descriptor: GPUBindGroupLayoutDescriptor },
      returns: GPUBindGroupLayout,
      capability: "heap",
      throws: true,
    },
    createPipelineLayout: {
      args: { descriptor: GPUPipelineLayoutDescriptor },
      returns: GPUPipelineLayout,
      capability: "heap",
    },
    createBindGroup: { args: { descriptor: GPUBindGroupDescriptor }, returns: GPUBindGroup, capability: "heap" },
    createShaderModule: {
      args: { descriptor: GPUShaderModuleDescriptor },
      returns: GPUShaderModule,
      capability: "heap",
    },
    createComputePipeline: {
      args: { descriptor: GPUComputePipelineDescriptor },
      returns: GPUComputePipeline,
      capability: "heap",
    },
    createRenderPipeline: {
      args: { descriptor: GPURenderPipelineDescriptor },
      returns: GPURenderPipeline,
      capability: "heap",
      throws: true,
    },
    createComputePipelineAsync: {
      args: { descriptor: GPUComputePipelineDescriptor },
      returns: promise,
      capability: "js",
      throws: true,
      rejects: true,
    },
    createRenderPipelineAsync: {
      args: { descriptor: GPURenderPipelineDescriptor },
      returns: promise,
      capability: "js",
      throws: true,
      rejects: true,
    },
    createCommandEncoder: {
      args: { descriptor: GPUCommandEncoderDescriptor.nullable.default({}) },
      returns: GPUCommandEncoder,
      capability: "heap",
    },
    createRenderBundleEncoder: {
      args: { descriptor: GPURenderBundleEncoderDescriptor },
      returns: GPURenderBundleEncoder,
      capability: "heap",
      throws: true,
    },
    createQuerySet: {
      args: { descriptor: GPUQuerySetDescriptor },
      returns: GPUQuerySet,
      capability: "heap",
      throws: true,
    },
    lost: { getter: promise, cache: true, capability: "js" },
    pushErrorScope: { args: { filter: GPUErrorFilter } },
    popErrorScope: { returns: promise, capability: "js", throws: true, rejects: true },
    onuncapturederror: { eventHandler: "uncapturederror" },
  },
});

// ───────────────────────────── adapters ─────────────────────────────

export const GPUDeviceDescriptor = dictionary(GPUObjectDescriptorBase, {
  requiredFeatures: b.sequence(GPUFeatureName).default([]),
  requiredLimits: b.record(GPUSize64.optional).default({}),
  defaultQueue: GPUQueueDescriptor.nullable.default({}),
});

export const GPUAdapter = b.class({
  ...webInterface,
  rustPath: rustPath("GPUAdapter"),
  proto: {
    features: { getter: GPUSupportedFeatures, cache: true, capability: "heap" },
    limits: { getter: GPUSupportedLimits, cache: true, capability: "heap" },
    info: { getter: GPUAdapterInfo, cache: true, capability: "heap" },
    requestDevice: {
      args: { descriptor: GPUDeviceDescriptor.nullable.default({}) },
      returns: promise,
      capability: "js",
      throws: true,
      rejects: true,
    },
  },
});

export const GPUPowerPreference = b.enumeration(["low-power", "high-performance"]);
export const GPURequestAdapterOptions = dictionary({
  featureLevel: utf8.default("core"),
  powerPreference: GPUPowerPreference.optional,
  forceFallbackAdapter: boolean.default(false),
  xrCompatible: boolean.default(false),
});

export const GPU = b.class({
  ...webInterface,
  rustPath: rustPath("GPU"),
  proto: {
    requestAdapter: {
      args: { options: GPURequestAdapterOptions.nullable.default({}) },
      returns: promise,
      capability: "js",
      throws: true,
      rejects: true,
    },
    getPreferredCanvasFormat: { returns: GPUTextureFormat },
    wgslLanguageFeatures: { getter: WGSLLanguageFeatures, cache: true, capability: "heap" },
  },
});

/** For `bun:internal-for-testing`. */
export const useNullBackendForTesting = b.fn({ args: { useIt: b.bool } });
/** Whether Dawn has said that the device of `queue` is lost, which JavaScript only hears from the `GPUDevice`. */
export const isDeviceLostForTesting = b.fn({ args: { queue: GPUQueue }, returns: b.bool });

/** `navigator.gpu`, for WebGPUBindings.cpp. */
export const createGPU = b.value({ returns: GPU, capability: "heap" });
