// https://gpuweb.github.io/gpuweb/#idl-index, without what takes a canvas, an image or a video frame.

import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::webgpu" });

const webIDL = true;
const estimatedSize = true;
const dictionary = (members: Record<string, b.Type | b.MemberOptions>, base?: b.DictionaryOptions["extends"]) =>
  b.dictionary(members, { webIDL, extends: base });
/** `dawn` is the enumeration of webgpu.h that has the same values. */
const enumeration = (dawn: string | null, values: Parameters<typeof b.enumeration>[0]) =>
  b.enumeration(values, { webIDL, rustInto: dawn === null ? undefined : `bun_dawn_sys::${dawn}` });
const interface_ = (name: string, options: b.ClassOptions) =>
  b.class({ rustPath: `crate::webgpu::${name}`, webIDL, construct: "illegal", ...options });
const constants = (values: Record<string, number>) =>
  b.namespace(Object.fromEntries(Object.entries(values).map(([name, constant]) => [name, { constant }])), { webIDL });

const boolean = b.bool.loose;
const float = b.f32.finite;
const double = b.f64.finite;
const DOMString = b.string.loose;
const USVString = b.string.usv;
/** A `USVString` that only Dawn reads. */
const UTF8String = b.string.loose.utf8;
const AllowSharedBufferSource = b.bufferSource.allowShared;

const GPUBufferDynamicOffset = b.u32.enforceRange();
const GPUStencilValue = b.u32.enforceRange();
const GPUSampleMask = b.u32.enforceRange();
const GPUDepthBias = b.i32.enforceRange();
const GPUSize64 = b.u64.enforceRange();
const GPUIntegerCoordinate = b.u32.enforceRange();
const GPUIndex32 = b.u32.enforceRange();
const GPUSize32 = b.u32.enforceRange();
const GPUSignedOffset32 = b.i32.enforceRange();
const GPUSize64Out = b.u64;
const GPUIntegerCoordinateOut = b.u32;
const GPUSize32Out = b.u32;
const GPUFlagsConstant = b.u32;
const GPUBufferUsageFlags = b.u32.enforceRange();
const GPUMapModeFlags = b.u32.enforceRange();
const GPUTextureUsageFlags = b.u32.enforceRange();
const GPUShaderStageFlags = b.u32.enforceRange();
const GPUColorWriteFlags = b.u32.enforceRange();
const GPUPipelineConstantValue = double;

const throws = { capability: "heap", throws: true } as const;
const promiseOf = (value: table.TableType) =>
  b.any.returning(table.instance("Promise").holding({ value, reason: table.any }).spec);
const resolvesTo = (value: table.TableType) =>
  ({ returns: promiseOf(value), capability: "js", throws: true, rejects: true }) as const;
/** The classes of what native code makes later on, for a listener or as the reason of a rejection. */
const makes = (...classes: string[]) => ({
  uses: { this: [table.retained, ...classes.map(name => table.createdIn(table.instance(name), table.nativeMemory))] },
});
/** It detaches buffers and rejects promises. */
const unmaps = { capability: "js", throws: true } as const;
const sameObject = (type: b.Type) => ({ getter: type, cache: true, capability: "heap" }) as const;
/** What can report an error to its device holds the object that made it, and so the listeners of the device. */
const internalFields = ["parent"];
const createsChild = (type: b.Type) => ({ returns: type, capability: "heap", passThis: true }) as const;

export const GPUColorDict = dictionary({ r: double, g: double, b: double, a: double });
export const GPUColor = b.union({ sequence: b.sequence(double), dictionary: GPUColorDict });

export const GPUOrigin3DDict = dictionary({
  x: GPUIntegerCoordinate.default(0),
  y: GPUIntegerCoordinate.default(0),
  z: GPUIntegerCoordinate.default(0),
});
export const GPUOrigin3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dictionary: GPUOrigin3DDict });

export const GPUExtent3DDict = dictionary({
  width: GPUIntegerCoordinate,
  height: GPUIntegerCoordinate.default(1),
  depthOrArrayLayers: GPUIntegerCoordinate.default(1),
});
export const GPUExtent3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dictionary: GPUExtent3DDict });

const GPUObjectBase = { label: { getter: USVString, setter: true } } as const;

export const GPUObjectDescriptorBase = dictionary({ label: USVString.default("") });

// ─── Errors ───

export const GPUDeviceLostReason = enumeration(null, ["unknown", "destroyed"]);

export const GPUDeviceLostInfo = interface_("GPUDeviceLostInfo", {
  proto: { reason: { getter: GPUDeviceLostReason }, message: { getter: b.string } },
});

export const GPUError = interface_("GPUError", { final: false, proto: { message: { getter: b.string } } });
const subclassOfGPUError = () =>
  b.class({ extends: GPUError, webIDL, construct: { args: { message: DOMString.owned } } });
export const GPUValidationError = subclassOfGPUError();
export const GPUOutOfMemoryError = subclassOfGPUError();
export const GPUInternalError = subclassOfGPUError();

const kindsOfError = ["GPUValidationError", "GPUOutOfMemoryError", "GPUInternalError"];

export const GPUErrorFilter = enumeration("ErrorFilter", ["validation", "out-of-memory", "internal"]);

export const GPUUncapturedErrorEventInit = dictionary({
  bubbles: boolean.default(false),
  cancelable: boolean.default(false),
  composed: boolean.default(false),
  error: GPUError.local,
});

export const GPUUncapturedErrorEvent = interface_("GPUUncapturedErrorEvent", {
  extends: "Event",
  construct: {
    args: { type: DOMString.owned, gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit },
    passStructure: true,
    capability: "heap",
  },
  /** `device` keeps the wrapper of `target` for an event that native code dispatched. */
  internalFields: ["error", "device"],
  proto: { error: { internalField: "error" } },
});

export const GPUPipelineErrorReason = enumeration(null, ["validation", "internal"]);
export const GPUPipelineErrorInit = dictionary({ reason: GPUPipelineErrorReason });

export const GPUPipelineError = interface_("GPUPipelineError", {
  extends: "DOMException",
  construct: { args: { message: DOMString.owned.default(""), options: GPUPipelineErrorInit } },
  proto: { reason: { getter: GPUPipelineErrorReason } },
});

// ─── Capabilities ───

export const GPUFeatureName = enumeration("FeatureName", [
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

export const GPUSupportedLimits = interface_("GPUSupportedLimits", {
  proto: {
    maxTextureDimension1D: { getter: b.u32, rustName: "max_texture_dimension_1d" },
    maxTextureDimension2D: { getter: b.u32, rustName: "max_texture_dimension_2d" },
    maxTextureDimension3D: { getter: b.u32, rustName: "max_texture_dimension_3d" },
    maxTextureArrayLayers: { getter: b.u32 },
    maxBindGroups: { getter: b.u32 },
    maxBindGroupsPlusVertexBuffers: { getter: b.u32 },
    maxImmediateSize: { getter: b.u32 },
    maxBindingsPerBindGroup: { getter: b.u32 },
    maxDynamicUniformBuffersPerPipelineLayout: { getter: b.u32 },
    maxDynamicStorageBuffersPerPipelineLayout: { getter: b.u32 },
    maxSampledTexturesPerShaderStage: { getter: b.u32 },
    maxSamplersPerShaderStage: { getter: b.u32 },
    maxStorageBuffersPerShaderStage: { getter: b.u32 },
    maxStorageBuffersInVertexStage: { getter: b.u32 },
    maxStorageBuffersInFragmentStage: { getter: b.u32 },
    maxStorageTexturesPerShaderStage: { getter: b.u32 },
    maxStorageTexturesInVertexStage: { getter: b.u32 },
    maxStorageTexturesInFragmentStage: { getter: b.u32 },
    maxUniformBuffersPerShaderStage: { getter: b.u32 },
    maxUniformBufferBindingSize: { getter: b.u64 },
    maxStorageBufferBindingSize: { getter: b.u64 },
    minUniformBufferOffsetAlignment: { getter: b.u32 },
    minStorageBufferOffsetAlignment: { getter: b.u32 },
    maxVertexBuffers: { getter: b.u32 },
    maxBufferSize: { getter: b.u64 },
    maxVertexAttributes: { getter: b.u32 },
    maxVertexBufferArrayStride: { getter: b.u32 },
    maxInterStageShaderVariables: { getter: b.u32 },
    maxColorAttachments: { getter: b.u32 },
    maxColorAttachmentBytesPerSample: { getter: b.u32 },
    maxComputeWorkgroupStorageSize: { getter: b.u32 },
    maxComputeInvocationsPerWorkgroup: { getter: b.u32 },
    maxComputeWorkgroupSizeX: { getter: b.u32 },
    maxComputeWorkgroupSizeY: { getter: b.u32 },
    maxComputeWorkgroupSizeZ: { getter: b.u32 },
    maxComputeWorkgroupsPerDimension: { getter: b.u32 },
  },
});

export const GPUSupportedFeatures = interface_("GPUSupportedFeatures", { setlike: true });

export const WGSLLanguageFeatures = interface_("WGSLLanguageFeatures", { setlike: true });

export const GPUAdapterInfo = interface_("GPUAdapterInfo", {
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

// ─── Buffers ───

export const GPUBufferMapState = enumeration(null, ["unmapped", "pending", "mapped"]);

export const GPUBuffer = interface_("GPUBuffer", {
  internalFields,
  estimatedSize,
  proto: {
    size: { getter: GPUSize64Out },
    usage: { getter: GPUFlagsConstant },
    mapState: { getter: GPUBufferMapState },
    mapAsync: {
      args: { mode: GPUMapModeFlags, offset: GPUSize64.default(0), size: GPUSize64.optional },
      ...resolvesTo(table.undefined),
    },
    getMappedRange: {
      args: { offset: GPUSize64.default(0), size: GPUSize64.optional },
      returns: b.any.returning("ArrayBuffer"),
      passThis: true,
      ...throws,
    },
    unmap: unmaps,
    destroy: unmaps,
    ...GPUObjectBase,
  },
});

export const GPUBufferDescriptor = dictionary(
  { size: GPUSize64, usage: GPUBufferUsageFlags, mappedAtCreation: boolean.default(false) },
  GPUObjectDescriptorBase,
);

export const GPUBufferUsage = constants({
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

export const GPUMapMode = constants({ READ: 0x0001, WRITE: 0x0002 });

// ─── Textures ───

export const GPUTextureDimension = enumeration("TextureDimension", { D1: "1d", D2: "2d", D3: "3d" });

export const GPUTextureUsage = constants({
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
  TRANSIENT_ATTACHMENT: 0x20,
});

export const GPUTextureViewDimension = enumeration("TextureViewDimension", {
  D1: "1d",
  D2: "2d",
  D2Array: "2d-array",
  Cube: "cube",
  CubeArray: "cube-array",
  D3: "3d",
});

export const GPUTextureAspect = enumeration("TextureAspect", ["all", "stencil-only", "depth-only"]);

export const GPUTextureFormat = enumeration("TextureFormat", [
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

export const GPUTextureView = interface_("GPUTextureView", { estimatedSize, proto: GPUObjectBase });

export const GPUTextureViewDescriptor = dictionary(
  {
    format: GPUTextureFormat.optional,
    dimension: GPUTextureViewDimension.optional,
    usage: GPUTextureUsageFlags.default(0),
    aspect: GPUTextureAspect.default("all"),
    baseMipLevel: GPUIntegerCoordinate.default(0),
    mipLevelCount: GPUIntegerCoordinate.optional,
    baseArrayLayer: GPUIntegerCoordinate.default(0),
    arrayLayerCount: GPUIntegerCoordinate.optional,
    swizzle: UTF8String.default("rgba"),
  },
  GPUObjectDescriptorBase,
);

export const GPUTexture = interface_("GPUTexture", {
  internalFields,
  estimatedSize,
  proto: {
    createView: { args: { descriptor: GPUTextureViewDescriptor.default({}) }, returns: GPUTextureView, ...throws },
    destroy: {},
    width: { getter: GPUIntegerCoordinateOut },
    height: { getter: GPUIntegerCoordinateOut },
    depthOrArrayLayers: { getter: GPUIntegerCoordinateOut },
    mipLevelCount: { getter: GPUIntegerCoordinateOut },
    sampleCount: { getter: GPUSize32Out },
    dimension: { getter: GPUTextureDimension },
    format: { getter: GPUTextureFormat },
    usage: { getter: GPUFlagsConstant },
    textureBindingViewDimension: { getter: GPUTextureViewDimension.optional },
    ...GPUObjectBase,
  },
});

export const GPUTextureDescriptor = dictionary(
  {
    size: GPUExtent3D,
    mipLevelCount: GPUIntegerCoordinate.default(1),
    sampleCount: GPUSize32.default(1),
    dimension: GPUTextureDimension.default("2d"),
    format: GPUTextureFormat,
    usage: GPUTextureUsageFlags,
    viewFormats: b.sequence(GPUTextureFormat).default([]),
    textureBindingViewDimension: GPUTextureViewDimension.optional,
  },
  GPUObjectDescriptorBase,
);

export const GPUTextureOrView = b.union({ texture: GPUTexture, view: GPUTextureView });

export const GPUExternalTexture = interface_("GPUExternalTexture", { proto: GPUObjectBase });

// ─── Samplers ───

export const GPUSampler = interface_("GPUSampler", { estimatedSize, proto: GPUObjectBase });

export const GPUAddressMode = enumeration("AddressMode", ["clamp-to-edge", "repeat", "mirror-repeat"]);
export const GPUFilterMode = enumeration("FilterMode", ["nearest", "linear"]);
export const GPUMipmapFilterMode = enumeration("MipmapFilterMode", ["nearest", "linear"]);
export const GPUCompareFunction = enumeration("CompareFunction", [
  "never",
  "less",
  "equal",
  "less-equal",
  "greater",
  "not-equal",
  "greater-equal",
  "always",
]);

export const GPUSamplerDescriptor = dictionary(
  {
    addressModeU: GPUAddressMode.default("clamp-to-edge"),
    addressModeV: GPUAddressMode.default("clamp-to-edge"),
    addressModeW: GPUAddressMode.default("clamp-to-edge"),
    magFilter: GPUFilterMode.default("nearest"),
    minFilter: GPUFilterMode.default("nearest"),
    mipmapFilter: GPUMipmapFilterMode.default("nearest"),
    lodMinClamp: float.default(0),
    lodMaxClamp: float.default(32),
    compare: GPUCompareFunction.optional,
    maxAnisotropy: b.u16.clamp.default(1),
  },
  GPUObjectDescriptorBase,
);

// ─── Resource binding ───

export const GPUBindGroupLayout = interface_("GPUBindGroupLayout", { estimatedSize, proto: GPUObjectBase });

export const GPUShaderStage = constants({ VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 });

export const GPUBufferBindingType = enumeration("BufferBindingType", ["uniform", "storage", "read-only-storage"]);

export const GPUBufferBindingLayout = dictionary({
  type: GPUBufferBindingType.default("uniform"),
  hasDynamicOffset: boolean.default(false),
  minBindingSize: GPUSize64.default(0),
});

export const GPUSamplerBindingType = enumeration("SamplerBindingType", ["filtering", "non-filtering", "comparison"]);

export const GPUSamplerBindingLayout = dictionary({ type: GPUSamplerBindingType.default("filtering") });

export const GPUTextureSampleType = enumeration("TextureSampleType", [
  "float",
  "unfilterable-float",
  "depth",
  "sint",
  "uint",
]);

export const GPUTextureBindingLayout = dictionary({
  sampleType: GPUTextureSampleType.default("float"),
  viewDimension: GPUTextureViewDimension.default("2d"),
  multisampled: boolean.default(false),
});

export const GPUStorageTextureAccess = enumeration("StorageTextureAccess", ["write-only", "read-only", "read-write"]);

export const GPUStorageTextureBindingLayout = dictionary({
  access: GPUStorageTextureAccess.default("write-only"),
  format: GPUTextureFormat,
  viewDimension: GPUTextureViewDimension.default("2d"),
});

export const GPUExternalTextureBindingLayout = dictionary({});

export const GPUBindGroupLayoutEntry = dictionary({
  binding: GPUIndex32,
  visibility: GPUShaderStageFlags,
  buffer: GPUBufferBindingLayout.optional,
  sampler: GPUSamplerBindingLayout.optional,
  texture: GPUTextureBindingLayout.optional,
  storageTexture: GPUStorageTextureBindingLayout.optional,
  externalTexture: GPUExternalTextureBindingLayout.optional,
});

export const GPUBindGroupLayoutDescriptor = dictionary(
  { entries: b.sequence(GPUBindGroupLayoutEntry) },
  GPUObjectDescriptorBase,
);

export const GPUBindGroup = interface_("GPUBindGroup", { estimatedSize, proto: GPUObjectBase });

export const GPUBufferBinding = dictionary({
  buffer: GPUBuffer,
  offset: GPUSize64.default(0),
  size: GPUSize64.optional,
});

export const GPUBindingResource = b.union({
  sampler: GPUSampler,
  texture: GPUTexture,
  view: GPUTextureView,
  buffer: GPUBuffer,
  binding: GPUBufferBinding,
});

export const GPUBindGroupEntry = dictionary({ binding: GPUIndex32, resource: GPUBindingResource });

export const GPUBindGroupDescriptor = dictionary(
  { layout: GPUBindGroupLayout, entries: b.sequence(GPUBindGroupEntry) },
  GPUObjectDescriptorBase,
);

export const GPUPipelineLayout = interface_("GPUPipelineLayout", { estimatedSize, proto: GPUObjectBase });

export const GPUPipelineLayoutDescriptor = dictionary(
  { bindGroupLayouts: b.sequence(GPUBindGroupLayout.nullable), immediateSize: GPUSize32.default(0) },
  GPUObjectDescriptorBase,
);

// ─── Shader modules ───

export const GPUCompilationMessageType = enumeration(null, ["error", "warning", "info"]);

export const GPUCompilationMessage = interface_("GPUCompilationMessage", {
  proto: {
    message: { getter: b.string },
    type: { getter: GPUCompilationMessageType },
    lineNum: { getter: b.u64 },
    linePos: { getter: b.u64 },
    offset: { getter: b.u64 },
    length: { getter: b.u64 },
  },
});

export const GPUCompilationInfo = interface_("GPUCompilationInfo", {
  proto: {
    messages: {
      ...sameObject(
        b.any.returning(table.instance("Array").holding({ element: table.instance("GPUCompilationMessage") }).spec),
      ),
      throws: true,
    },
  },
});

export const GPUShaderModule = interface_("GPUShaderModule", {
  internalFields,
  estimatedSize,
  proto: { getCompilationInfo: resolvesTo(table.instance("GPUCompilationInfo")), ...GPUObjectBase },
});

export const GPUAutoLayoutMode = enumeration(null, ["auto"]);
export const GPUPipelineLayoutOrAuto = b.union({ layout: GPUPipelineLayout, mode: GPUAutoLayoutMode });

export const GPUShaderModuleCompilationHint = dictionary({
  entryPoint: USVString,
  layout: GPUPipelineLayoutOrAuto.optional,
});

export const GPUShaderModuleDescriptor = dictionary(
  { code: UTF8String, compilationHints: b.sequence(GPUShaderModuleCompilationHint).default([]) },
  GPUObjectDescriptorBase,
);

// ─── Pipelines ───

export const GPUPipelineDescriptorBase = dictionary({ layout: GPUPipelineLayoutOrAuto }, GPUObjectDescriptorBase);

const GPUPipelineBase = {
  getBindGroupLayout: { args: { index: b.u32.wrap }, returns: GPUBindGroupLayout, capability: "heap" },
} as const;

export const GPUProgrammableStage = dictionary({
  module: GPUShaderModule,
  entryPoint: UTF8String.optional,
  constants: b.record(GPUPipelineConstantValue).default({}),
});

export const GPUComputePipeline = interface_("GPUComputePipeline", {
  internalFields,
  estimatedSize,
  proto: { ...GPUObjectBase, ...GPUPipelineBase },
});

export const GPUComputePipelineDescriptor = dictionary({ compute: GPUProgrammableStage }, GPUPipelineDescriptorBase);

export const GPURenderPipeline = interface_("GPURenderPipeline", {
  internalFields,
  estimatedSize,
  proto: { ...GPUObjectBase, ...GPUPipelineBase },
});

export const GPUPrimitiveTopology = enumeration("PrimitiveTopology", [
  "point-list",
  "line-list",
  "line-strip",
  "triangle-list",
  "triangle-strip",
]);
export const GPUFrontFace = enumeration("FrontFace", ["ccw", "cw"]);
export const GPUCullMode = enumeration("CullMode", ["none", "front", "back"]);
export const GPUIndexFormat = enumeration("IndexFormat", ["uint16", "uint32"]);

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

export const GPUColorWrite = constants({ RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xf });

export const GPUBlendFactor = enumeration("BlendFactor", [
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

export const GPUBlendOperation = enumeration("BlendOperation", ["add", "subtract", "reverse-subtract", "min", "max"]);

export const GPUBlendComponent = dictionary({
  operation: GPUBlendOperation.default("add"),
  srcFactor: GPUBlendFactor.default("one"),
  dstFactor: GPUBlendFactor.default("zero"),
});

export const GPUBlendState = dictionary({ color: GPUBlendComponent, alpha: GPUBlendComponent });

export const GPUColorTargetState = dictionary({
  format: GPUTextureFormat,
  blend: GPUBlendState.optional,
  writeMask: GPUColorWriteFlags.default(0xf),
});

export const GPUFragmentState = dictionary({ targets: b.sequence(GPUColorTargetState.nullable) }, GPUProgrammableStage);

export const GPUStencilOperation = enumeration("StencilOperation", [
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
  stencilFront: GPUStencilFaceState.default({}),
  stencilBack: GPUStencilFaceState.default({}),
  stencilReadMask: GPUStencilValue.default(0xffffffff),
  stencilWriteMask: GPUStencilValue.default(0xffffffff),
  depthBias: GPUDepthBias.default(0),
  depthBiasSlopeScale: float.default(0),
  depthBiasClamp: float.default(0),
});

export const GPUVertexFormat = enumeration("VertexFormat", [
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

export const GPUVertexStepMode = enumeration("VertexStepMode", ["vertex", "instance"]);

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

export const GPUVertexState = dictionary(
  { buffers: b.sequence(GPUVertexBufferLayout.nullable).default([]) },
  GPUProgrammableStage,
);

export const GPURenderPipelineDescriptor = dictionary(
  {
    vertex: GPUVertexState,
    primitive: GPUPrimitiveState.default({}),
    depthStencil: GPUDepthStencilState.optional,
    multisample: GPUMultisampleState.default({}),
    fragment: GPUFragmentState.optional,
  },
  GPUPipelineDescriptorBase,
);

// ─── Copies ───

export const GPUTexelCopyBufferLayout = dictionary({
  offset: GPUSize64.default(0),
  bytesPerRow: GPUSize32.optional,
  rowsPerImage: GPUSize32.optional,
});

export const GPUTexelCopyBufferInfo = dictionary({ buffer: GPUBuffer }, GPUTexelCopyBufferLayout);

export const GPUTexelCopyTextureInfo = dictionary({
  texture: GPUTexture,
  mipLevel: GPUIntegerCoordinate.default(0),
  origin: GPUOrigin3D.default({}),
  aspect: GPUTextureAspect.default("all"),
});

// ─── Queries ───

export const GPUQueryType = enumeration("QueryType", ["occlusion", "timestamp"]);

export const GPUQuerySet = interface_("GPUQuerySet", {
  estimatedSize,
  proto: { destroy: {}, type: { getter: GPUQueryType }, count: { getter: GPUSize32Out }, ...GPUObjectBase },
});

export const GPUQuerySetDescriptor = dictionary({ type: GPUQueryType, count: GPUSize32 }, GPUObjectDescriptorBase);

// ─── Command encoding ───

export const GPUCommandBuffer = interface_("GPUCommandBuffer", { estimatedSize, proto: GPUObjectBase });

export const GPUCommandBufferDescriptor = dictionary({}, GPUObjectDescriptorBase);

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
        dynamicOffsetsData: b.uint32Array,
        dynamicOffsetsDataStart: GPUSize64,
        dynamicOffsetsDataLength: GPUSize32,
      },
      ...throws,
    },
  ],
  setImmediates: {
    args: {
      rangeOffset: GPUSize32,
      data: AllowSharedBufferSource,
      dataOffset: GPUSize64.default(0),
      dataSize: GPUSize64.optional,
    },
    ...throws,
  },
} as const;

const GPUDebugCommandsMixin = {
  pushDebugGroup: { args: { groupLabel: UTF8String } },
  popDebugGroup: {},
  insertDebugMarker: { args: { markerLabel: UTF8String } },
} as const;

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

const timestampWrites = {
  querySet: GPUQuerySet,
  beginningOfPassWriteIndex: GPUSize32.optional,
  endOfPassWriteIndex: GPUSize32.optional,
};

export const GPUComputePassEncoder = interface_("GPUComputePassEncoder", {
  internalFields,
  proto: {
    setPipeline: { args: { pipeline: GPUComputePipeline } },
    dispatchWorkgroups: {
      args: {
        workgroupCountX: GPUSize32,
        workgroupCountY: GPUSize32.default(1),
        workgroupCountZ: GPUSize32.default(1),
      },
    },
    dispatchWorkgroupsIndirect: { args: { indirectBuffer: GPUBuffer, indirectOffset: GPUSize64 }, ...throws },
    end: {},
    ...GPUObjectBase,
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
  },
});

export const GPUComputePassTimestampWrites = dictionary(timestampWrites);

export const GPUComputePassDescriptor = dictionary(
  { timestampWrites: GPUComputePassTimestampWrites.optional },
  GPUObjectDescriptorBase,
);

export const GPURenderBundle = interface_("GPURenderBundle", { estimatedSize, proto: GPUObjectBase });

export const GPURenderBundleDescriptor = dictionary({}, GPUObjectDescriptorBase);

export const GPURenderPassEncoder = interface_("GPURenderPassEncoder", {
  internalFields,
  proto: {
    setViewport: { args: { x: float, y: float, width: float, height: float, minDepth: float, maxDepth: float } },
    setScissorRect: {
      args: {
        x: GPUIntegerCoordinate,
        y: GPUIntegerCoordinate,
        width: GPUIntegerCoordinate,
        height: GPUIntegerCoordinate,
      },
    },
    setBlendConstant: { args: { color: GPUColor }, ...throws },
    setStencilReference: { args: { reference: GPUStencilValue } },
    beginOcclusionQuery: { args: { queryIndex: GPUSize32 } },
    endOcclusionQuery: {},
    executeBundles: { args: { bundles: b.sequence(GPURenderBundle) } },
    end: throws,
    ...GPUObjectBase,
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
    ...GPURenderCommandsMixin,
  },
});

export const GPURenderPassTimestampWrites = dictionary(timestampWrites);

export const GPULoadOp = enumeration("LoadOp", ["load", "clear"]);
export const GPUStoreOp = enumeration("StoreOp", ["store", "discard"]);

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
  depthClearValue: float.optional,
  depthLoadOp: GPULoadOp.optional,
  depthStoreOp: GPUStoreOp.optional,
  depthReadOnly: boolean.default(false),
  stencilClearValue: GPUStencilValue.default(0),
  stencilLoadOp: GPULoadOp.optional,
  stencilStoreOp: GPUStoreOp.optional,
  stencilReadOnly: boolean.default(false),
});

export const GPURenderPassDescriptor = dictionary(
  {
    colorAttachments: b.sequence(GPURenderPassColorAttachment.nullable),
    depthStencilAttachment: GPURenderPassDepthStencilAttachment.optional,
    occlusionQuerySet: GPUQuerySet.optional,
    timestampWrites: GPURenderPassTimestampWrites.optional,
    maxDrawCount: GPUSize64.default(50000000),
  },
  GPUObjectDescriptorBase,
);

export const GPURenderPassLayout = dictionary(
  {
    colorFormats: b.sequence(GPUTextureFormat.nullable),
    depthStencilFormat: GPUTextureFormat.optional,
    sampleCount: GPUSize32.default(1),
  },
  GPUObjectDescriptorBase,
);

export const GPURenderBundleEncoder = interface_("GPURenderBundleEncoder", {
  internalFields,
  estimatedSize,
  proto: {
    finish: {
      args: { descriptor: GPURenderBundleDescriptor.default({}) },
      returns: GPURenderBundle,
      capability: "heap",
    },
    ...GPUObjectBase,
    ...GPUDebugCommandsMixin,
    ...GPUBindingCommandsMixin,
    ...GPURenderCommandsMixin,
  },
});

export const GPURenderBundleEncoderDescriptor = dictionary(
  { depthReadOnly: boolean.default(false), stencilReadOnly: boolean.default(false) },
  GPURenderPassLayout,
);

export const GPUCommandEncoder = interface_("GPUCommandEncoder", {
  internalFields,
  estimatedSize,
  proto: {
    beginRenderPass: {
      args: { descriptor: GPURenderPassDescriptor },
      ...createsChild(GPURenderPassEncoder),
      ...throws,
    },
    beginComputePass: {
      args: { descriptor: GPUComputePassDescriptor.default({}) },
      ...createsChild(GPUComputePassEncoder),
    },
    copyBufferToBuffer: [
      {
        rustName: "copy_buffer_to_buffer_from_start",
        args: { source: GPUBuffer, destination: GPUBuffer, size: GPUSize64.optional },
      },
      {
        rustName: "copy_buffer_to_buffer",
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
      ...throws,
    },
    copyTextureToBuffer: {
      args: { source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyBufferInfo, copySize: GPUExtent3D },
      ...throws,
    },
    copyTextureToTexture: {
      args: { source: GPUTexelCopyTextureInfo, destination: GPUTexelCopyTextureInfo, copySize: GPUExtent3D },
      ...throws,
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
      ...throws,
    },
    finish: {
      args: { descriptor: GPUCommandBufferDescriptor.default({}) },
      returns: GPUCommandBuffer,
      capability: "heap",
    },
    ...GPUObjectBase,
    ...GPUDebugCommandsMixin,
  },
});

export const GPUCommandEncoderDescriptor = dictionary({}, GPUObjectDescriptorBase);

// ─── Queues ───

export const GPUQueueDescriptor = dictionary({}, GPUObjectDescriptorBase);

export const GPUQueue = interface_("GPUQueue", {
  internalFields,
  proto: {
    submit: { args: { commandBuffers: b.sequence(GPUCommandBuffer) }, ...throws },
    onSubmittedWorkDone: resolvesTo(table.undefined),
    writeBuffer: {
      args: {
        buffer: GPUBuffer,
        bufferOffset: GPUSize64,
        data: AllowSharedBufferSource,
        dataOffset: GPUSize64.default(0),
        size: GPUSize64.optional,
      },
      ...throws,
    },
    writeTexture: {
      args: {
        destination: GPUTexelCopyTextureInfo,
        data: AllowSharedBufferSource,
        dataLayout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      },
      ...throws,
    },
    ...GPUObjectBase,
  },
});

// ─── Initialization ───

export const GPUDevice = interface_("GPUDevice", {
  extends: "EventTarget",
  proto: {
    features: sameObject(GPUSupportedFeatures),
    limits: sameObject(GPUSupportedLimits),
    adapterInfo: sameObject(GPUAdapterInfo),
    queue: { ...sameObject(GPUQueue), passThis: true },
    destroy: unmaps,
    createBuffer: { args: { descriptor: GPUBufferDescriptor }, ...createsChild(GPUBuffer), ...throws },
    createTexture: { args: { descriptor: GPUTextureDescriptor }, ...createsChild(GPUTexture), ...throws },
    createSampler: { args: { descriptor: GPUSamplerDescriptor.default({}) }, returns: GPUSampler, capability: "heap" },
    createBindGroupLayout: {
      args: { descriptor: GPUBindGroupLayoutDescriptor },
      returns: GPUBindGroupLayout,
      ...throws,
    },
    createPipelineLayout: {
      args: { descriptor: GPUPipelineLayoutDescriptor },
      returns: GPUPipelineLayout,
      capability: "heap",
    },
    createBindGroup: { args: { descriptor: GPUBindGroupDescriptor }, returns: GPUBindGroup, capability: "heap" },
    createShaderModule: {
      args: { descriptor: GPUShaderModuleDescriptor },
      ...createsChild(GPUShaderModule),
      ...throws,
    },
    createComputePipeline: {
      args: { descriptor: GPUComputePipelineDescriptor },
      ...createsChild(GPUComputePipeline),
      ...throws,
    },
    createRenderPipeline: {
      args: { descriptor: GPURenderPipelineDescriptor },
      ...createsChild(GPURenderPipeline),
      ...throws,
    },
    createComputePipelineAsync: {
      args: { descriptor: GPUComputePipelineDescriptor },
      ...resolvesTo(table.instance("GPUComputePipeline")),
      ...makes("GPUPipelineError"),
      passThis: true,
    },
    createRenderPipelineAsync: {
      args: { descriptor: GPURenderPipelineDescriptor },
      ...resolvesTo(table.instance("GPURenderPipeline")),
      ...makes("GPUPipelineError"),
      passThis: true,
    },
    createCommandEncoder: {
      args: { descriptor: GPUCommandEncoderDescriptor.default({}) },
      ...createsChild(GPUCommandEncoder),
    },
    createRenderBundleEncoder: {
      args: { descriptor: GPURenderBundleEncoderDescriptor },
      ...createsChild(GPURenderBundleEncoder),
      ...throws,
    },
    createQuerySet: { args: { descriptor: GPUQuerySetDescriptor }, returns: GPUQuerySet, ...throws },
    ...GPUObjectBase,
    lost: { getter: promiseOf(table.instance("GPUDeviceLostInfo")), cache: true, capability: "js", rejects: true },
    pushErrorScope: { args: { filter: GPUErrorFilter } },
    popErrorScope: resolvesTo(table.union(table.strictNull, ...kindsOfError.map(table.instance))),
    onuncapturederror: { eventHandler: "uncapturederror" },
  },
});

export const GPUDeviceDescriptor = dictionary(
  {
    requiredFeatures: b.sequence(GPUFeatureName).default([]),
    requiredLimits: b.record(GPUSize64.optional).default({}),
    defaultQueue: GPUQueueDescriptor.default({}),
  },
  GPUObjectDescriptorBase,
);

export const GPUAdapter = interface_("GPUAdapter", {
  proto: {
    features: sameObject(GPUSupportedFeatures),
    limits: sameObject(GPUSupportedLimits),
    info: sameObject(GPUAdapterInfo),
    requestDevice: {
      args: { descriptor: GPUDeviceDescriptor.default({}) },
      ...resolvesTo(table.instance("GPUDevice")),
      ...makes("GPUUncapturedErrorEvent", ...kindsOfError),
    },
  },
});

export const GPUPowerPreference = enumeration("PowerPreference", ["low-power", "high-performance"]);

export const GPURequestAdapterOptions = dictionary({
  featureLevel: UTF8String.default("core"),
  powerPreference: GPUPowerPreference.optional,
  forceFallbackAdapter: boolean.default(false),
  xrCompatible: boolean.default(false),
});

export const GPU = interface_("GPU", {
  proto: {
    requestAdapter: {
      args: { options: GPURequestAdapterOptions.default({}) },
      ...resolvesTo(table.union(table.strictNull, table.instance("GPUAdapter"))),
    },
    getPreferredCanvasFormat: { returns: GPUTextureFormat },
    wgslLanguageFeatures: sameObject(WGSLLanguageFeatures),
  },
});
