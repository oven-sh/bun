// Written by src/codegen/generate-webgpu-bindings.ts, from webgpu.idl.

import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::webgpu" });

const promiseOf = (value: table.TableType) =>
  b.any.returning(table.instance("Promise").holding({ value, reason: table.any }).spec);
const typesOf = (name: string) => [
  table.viewType(name),
  table.viewType(`bun.WebGPU.${name}`),
  table.exactType(`$Bindgen.${name}`),
];
/** The call is done with the bytes when it returns. */
const copied = [table.readsContents()];
/** What a device makes in a later turn of the event loop, for a listener or a promise. */
const madeByDevice = [
  "GPUDeviceLostInfo",
  "GPUInternalError",
  "GPUOutOfMemoryError",
  "GPUPipelineError",
  "GPUUncapturedErrorEvent",
  "GPUValidationError",
].map(name => table.createdIn(table.instance(name), table.nativeMemory));

const iteratorOver = (element: table.TableType) =>
  ({
    returns: b.any.returning(table.instance("SetIterator").holding({ element }).spec),
    capability: "heap",
    passThis: true,
  }) as const;
const setlike = {
  size: { getter: b.u32 },
  has: { args: { value: b.string.loose }, returns: b.bool },
  entries: iteratorOver(table.instance("Array").holding({ element: table.string })),
  keys: iteratorOver(table.string),
  values: iteratorOver(table.string),
  forEach: {
    args: { callback: b.callable, thisArg: b.any },
    capability: "js",
    throws: true,
    passThis: true,
    length: 1,
  },
  "@@iterator": { ...iteratorOver(table.string), rustName: "values" },
} as const;

export const GPUSupportedLimits = b.class({
  types: typesOf("GPUSupportedLimits"),
  rustPath: "crate::webgpu::GPUSupportedLimits",
  configurable: true,
  construct: "illegal",
  proto: {
    maxTextureDimension1D: { getter: b.u32 },
    maxTextureDimension2D: { getter: b.u32 },
    maxTextureDimension3D: { getter: b.u32 },
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
export const GPUSupportedFeatures = b.class({
  types: typesOf("GPUSupportedFeatures"),
  rustPath: "crate::webgpu::GPUSupportedFeatures",
  configurable: true,
  internalFields: ["set"],
  construct: "illegal",
  proto: { ...setlike },
});
export const WGSLLanguageFeatures = b.class({
  types: typesOf("WGSLLanguageFeatures"),
  rustPath: "crate::webgpu::WGSLLanguageFeatures",
  configurable: true,
  internalFields: ["set"],
  construct: "illegal",
  proto: { ...setlike },
});
export const GPUAdapterInfo = b.class({
  types: typesOf("GPUAdapterInfo"),
  rustPath: "crate::webgpu::GPUAdapterInfo",
  configurable: true,
  construct: "illegal",
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
export const GPUPowerPreference = b.enumeration(["low-power", "high-performance"]);
export const GPURequestAdapterOptions = b.dictionary(
  {
    featureLevel: b.string.loose.utf8.default("core"),
    forceFallbackAdapter: b.bool.loose.default(false),
    powerPreference: GPUPowerPreference.optional,
    xrCompatible: b.bool.loose.default(false),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUQueueDescriptor = b.dictionary(
  { label: b.string.usv.default("") },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
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
const GPUSize64 = b.u64.enforceRange();
export const GPUDeviceDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    defaultQueue: GPUQueueDescriptor.default({}),
    requiredFeatures: b.sequence(GPUFeatureName).default([]),
    requiredLimits: b.record(GPUSize64.optional).default({}),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUCommandBuffer = b.class({
  types: typesOf("GPUCommandBuffer"),
  rustPath: "crate::webgpu::GPUCommandBuffer",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUBufferMapState = b.enumeration(["unmapped", "pending", "mapped"]);
const GPUMapModeFlags = b.u32.enforceRange();
export const GPUBuffer = b.class({
  types: typesOf("GPUBuffer"),
  rustPath: "crate::webgpu::GPUBuffer",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  estimatedSize: true,
  construct: "illegal",
  proto: {
    size: { getter: b.u64 },
    usage: { getter: b.u32 },
    mapState: { getter: GPUBufferMapState },
    mapAsync: {
      args: { mode: GPUMapModeFlags, offset: GPUSize64.default(0), size: GPUSize64.optional },
      returns: promiseOf(table.undefined),
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
    label: { getter: b.string.usv, setter: true },
  },
});
export const GPUTextureAspect = b.enumeration(["all", "stencil-only", "depth-only"]);
const GPUIntegerCoordinate = b.u32.enforceRange();
export const GPUOrigin3DDict = b.dictionary(
  { x: GPUIntegerCoordinate.default(0), y: GPUIntegerCoordinate.default(0), z: GPUIntegerCoordinate.default(0) },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUOrigin3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dict: GPUOrigin3DDict });
export const GPUTextureViewDimension = b.enumeration({
  D1: "1d",
  D2: "2d",
  D2Array: "2d-array",
  Cube: "cube",
  CubeArray: "cube-array",
  D3: "3d",
});
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
const GPUTextureUsageFlags = b.u32.enforceRange();
export const GPUTextureViewDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    arrayLayerCount: GPUIntegerCoordinate.optional,
    aspect: GPUTextureAspect.default("all"),
    baseArrayLayer: GPUIntegerCoordinate.default(0),
    baseMipLevel: GPUIntegerCoordinate.default(0),
    dimension: GPUTextureViewDimension.optional,
    format: GPUTextureFormat.optional,
    mipLevelCount: GPUIntegerCoordinate.optional,
    swizzle: b.string.loose.utf8.default("rgba"),
    usage: GPUTextureUsageFlags.default(0),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUTextureView = b.class({
  types: typesOf("GPUTextureView"),
  rustPath: "crate::webgpu::GPUTextureView",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUTextureDimension = b.enumeration({ D1: "1d", D2: "2d", D3: "3d" });
export const GPUTexture = b.class({
  types: typesOf("GPUTexture"),
  rustPath: "crate::webgpu::GPUTexture",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  estimatedSize: true,
  construct: "illegal",
  proto: {
    createView: {
      args: { descriptor: GPUTextureViewDescriptor.default({}) },
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
    label: { getter: b.string.usv, setter: true },
  },
});
export const GPUTexelCopyTextureInfo = b.dictionary(
  {
    aspect: GPUTextureAspect.default("all"),
    mipLevel: GPUIntegerCoordinate.default(0),
    origin: GPUOrigin3D.optional,
    texture: GPUTexture.ref,
  },
  { allowArray: true },
);
const GPUSize32 = b.u32.enforceRange();
export const GPUTexelCopyBufferLayout = b.dictionary(
  { bytesPerRow: GPUSize32.optional, offset: GPUSize64.default(0), rowsPerImage: GPUSize32.optional },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUExtent3DDict = b.dictionary(
  {
    depthOrArrayLayers: GPUIntegerCoordinate.default(1),
    height: GPUIntegerCoordinate.default(1),
    width: GPUIntegerCoordinate,
  },
  { allowArray: true },
);
export const GPUExtent3D = b.union({ sequence: b.sequence(GPUIntegerCoordinate), dict: GPUExtent3DDict });
export const GPUQueue = b.class({
  types: typesOf("GPUQueue"),
  rustPath: "crate::webgpu::GPUQueue",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    submit: { args: { commandBuffers: b.sequence(GPUCommandBuffer.ref) } },
    onSubmittedWorkDone: { returns: promiseOf(table.undefined), capability: "js", throws: true, rejects: true },
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
      uses: { data: copied },
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
      uses: { data: copied },
    },
    label: { getter: b.string.usv, setter: true },
  },
});
const GPUBufferUsageFlags = b.u32.enforceRange();
export const GPUBufferDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    mappedAtCreation: b.bool.loose.default(false),
    size: GPUSize64,
    usage: GPUBufferUsageFlags,
  },
  { allowArray: true },
);
export const GPUTextureDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    dimension: GPUTextureDimension.default("2d"),
    format: GPUTextureFormat,
    mipLevelCount: GPUIntegerCoordinate.default(1),
    sampleCount: GPUSize32.default(1),
    size: GPUExtent3D,
    textureBindingViewDimension: GPUTextureViewDimension.optional,
    usage: GPUTextureUsageFlags,
    viewFormats: b.sequence(GPUTextureFormat).default([]),
  },
  { allowArray: true },
);
export const GPUAddressMode = b.enumeration(["clamp-to-edge", "repeat", "mirror-repeat"]);
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
export const GPUFilterMode = b.enumeration(["nearest", "linear"]);
export const GPUMipmapFilterMode = b.enumeration(["nearest", "linear"]);
export const GPUSamplerDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    addressModeU: GPUAddressMode.default("clamp-to-edge"),
    addressModeV: GPUAddressMode.default("clamp-to-edge"),
    addressModeW: GPUAddressMode.default("clamp-to-edge"),
    compare: GPUCompareFunction.optional,
    lodMaxClamp: b.f32.default(32),
    lodMinClamp: b.f32.default(0),
    magFilter: GPUFilterMode.default("nearest"),
    maxAnisotropy: b.u16.clamp.default(1),
    minFilter: GPUFilterMode.default("nearest"),
    mipmapFilter: GPUMipmapFilterMode.default("nearest"),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUSampler = b.class({
  types: typesOf("GPUSampler"),
  rustPath: "crate::webgpu::GPUSampler",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
const GPUIndex32 = b.u32.enforceRange();
export const GPUBufferBindingType = b.enumeration(["uniform", "storage", "read-only-storage"]);
export const GPUBufferBindingLayout = b.dictionary(
  {
    hasDynamicOffset: b.bool.loose.default(false),
    minBindingSize: GPUSize64.default(0),
    type: GPUBufferBindingType.default("uniform"),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUExternalTextureBindingLayout = b.dictionary({}, { allowArray: true, nonObjectAsEmpty: "nullish" });
export const GPUSamplerBindingType = b.enumeration(["filtering", "non-filtering", "comparison"]);
export const GPUSamplerBindingLayout = b.dictionary(
  { type: GPUSamplerBindingType.default("filtering") },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUStorageTextureAccess = b.enumeration(["write-only", "read-only", "read-write"]);
export const GPUStorageTextureBindingLayout = b.dictionary(
  {
    access: GPUStorageTextureAccess.default("write-only"),
    format: GPUTextureFormat,
    viewDimension: GPUTextureViewDimension.default("2d"),
  },
  { allowArray: true },
);
export const GPUTextureSampleType = b.enumeration(["float", "unfilterable-float", "depth", "sint", "uint"]);
export const GPUTextureBindingLayout = b.dictionary(
  {
    multisampled: b.bool.loose.default(false),
    sampleType: GPUTextureSampleType.default("float"),
    viewDimension: GPUTextureViewDimension.default("2d"),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
const GPUShaderStageFlags = b.u32.enforceRange();
export const GPUBindGroupLayoutEntry = b.dictionary(
  {
    binding: GPUIndex32,
    buffer: GPUBufferBindingLayout.optional,
    externalTexture: GPUExternalTextureBindingLayout.optional,
    sampler: GPUSamplerBindingLayout.optional,
    storageTexture: GPUStorageTextureBindingLayout.optional,
    texture: GPUTextureBindingLayout.optional,
    visibility: GPUShaderStageFlags,
  },
  { allowArray: true },
);
export const GPUBindGroupLayoutDescriptor = b.dictionary(
  { label: b.string.usv.default(""), entries: b.sequence(GPUBindGroupLayoutEntry) },
  { allowArray: true },
);
export const GPUBindGroupLayout = b.class({
  types: typesOf("GPUBindGroupLayout"),
  rustPath: "crate::webgpu::GPUBindGroupLayout",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUPipelineLayoutDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    bindGroupLayouts: b.sequence(GPUBindGroupLayout.ref.nullable),
    immediateSize: GPUSize32.default(0),
  },
  { allowArray: true },
);
export const GPUPipelineLayout = b.class({
  types: typesOf("GPUPipelineLayout"),
  rustPath: "crate::webgpu::GPUPipelineLayout",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUBufferBinding = b.dictionary(
  { buffer: GPUBuffer.ref, offset: GPUSize64.default(0), size: GPUSize64.optional },
  { allowArray: true },
);
export const GPUBindingResource = b.union({
  sampler: GPUSampler.ref,
  texture: GPUTexture.ref,
  textureView: GPUTextureView.ref,
  buffer: GPUBuffer.ref,
  bufferBinding: GPUBufferBinding,
});
export const GPUBindGroupEntry = b.dictionary(
  { binding: GPUIndex32, resource: GPUBindingResource },
  { allowArray: true },
);
export const GPUBindGroupDescriptor = b.dictionary(
  { label: b.string.usv.default(""), entries: b.sequence(GPUBindGroupEntry), layout: GPUBindGroupLayout.ref },
  { allowArray: true },
);
export const GPUBindGroup = b.class({
  types: typesOf("GPUBindGroup"),
  rustPath: "crate::webgpu::GPUBindGroup",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUAutoLayoutMode = b.enumeration(["auto"]);
export const GPUPipelineLayoutOrAuto = b.union({ layout: GPUPipelineLayout.ref, automatic: GPUAutoLayoutMode });
export const GPUShaderModuleCompilationHint = b.dictionary(
  { entryPoint: b.string.usv, layout: GPUPipelineLayoutOrAuto.optional },
  { allowArray: true },
);
export const GPUShaderModuleDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    code: b.string.loose.utf8,
    compilationHints: b.sequence(GPUShaderModuleCompilationHint).default([]),
  },
  { allowArray: true },
);
export const GPUCompilationInfo = b.class({
  types: typesOf("GPUCompilationInfo"),
  rustPath: "crate::webgpu::GPUCompilationInfo",
  configurable: true,
  internalFields: ["messages"],
  construct: "illegal",
  proto: { messages: { internalField: "messages" } },
});
export const GPUShaderModule = b.class({
  types: typesOf("GPUShaderModule"),
  rustPath: "crate::webgpu::GPUShaderModule",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: {
    getCompilationInfo: {
      returns: promiseOf(table.instance("GPUCompilationInfo")),
      capability: "js",
      throws: true,
      rejects: true,
    },
    label: { getter: b.string.usv, setter: true },
  },
});
const GPUPipelineConstantValue = b.f64.loose.finite;
export const GPUProgrammableStage = b.dictionary(
  {
    constants: b.record(GPUPipelineConstantValue).default({}),
    entryPoint: b.string.loose.utf8.optional,
    module: GPUShaderModule.ref,
  },
  { allowArray: true },
);
export const GPUComputePipelineDescriptor = b.dictionary(
  { label: b.string.usv.default(""), layout: GPUPipelineLayoutOrAuto, compute: GPUProgrammableStage },
  { allowArray: true },
);
export const GPUComputePipeline = b.class({
  types: typesOf("GPUComputePipeline"),
  rustPath: "crate::webgpu::GPUComputePipeline",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    label: { getter: b.string.usv, setter: true },
    getBindGroupLayout: { args: { index: b.u32.wrap }, returns: GPUBindGroupLayout, capability: "heap" },
  },
});
const GPUDepthBias = b.i32.enforceRange();
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
export const GPUStencilFaceState = b.dictionary(
  {
    compare: GPUCompareFunction.default("always"),
    depthFailOp: GPUStencilOperation.default("keep"),
    failOp: GPUStencilOperation.default("keep"),
    passOp: GPUStencilOperation.default("keep"),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
const GPUStencilValue = b.u32.enforceRange();
export const GPUDepthStencilState = b.dictionary(
  {
    depthBias: GPUDepthBias.default(0),
    depthBiasClamp: b.f32.default(0),
    depthBiasSlopeScale: b.f32.default(0),
    depthCompare: GPUCompareFunction.optional,
    depthWriteEnabled: b.bool.loose.optional,
    format: GPUTextureFormat,
    stencilBack: GPUStencilFaceState.default({}),
    stencilFront: GPUStencilFaceState.default({}),
    stencilReadMask: GPUStencilValue.default(0xffffffff),
    stencilWriteMask: GPUStencilValue.default(0xffffffff),
  },
  { allowArray: true },
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
export const GPUBlendComponent = b.dictionary(
  {
    dstFactor: GPUBlendFactor.default("zero"),
    operation: GPUBlendOperation.default("add"),
    srcFactor: GPUBlendFactor.default("one"),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUBlendState = b.dictionary({ alpha: GPUBlendComponent, color: GPUBlendComponent }, { allowArray: true });
const GPUColorWriteFlags = b.u32.enforceRange();
export const GPUColorTargetState = b.dictionary(
  { blend: GPUBlendState.optional, format: GPUTextureFormat, writeMask: GPUColorWriteFlags.default(0xf) },
  { allowArray: true },
);
export const GPUFragmentState = b.dictionary(
  {
    constants: b.record(GPUPipelineConstantValue).default({}),
    entryPoint: b.string.loose.utf8.optional,
    module: GPUShaderModule.ref,
    targets: b.sequence(GPUColorTargetState.nullable),
  },
  { allowArray: true },
);
const GPUSampleMask = b.u32.enforceRange();
export const GPUMultisampleState = b.dictionary(
  {
    alphaToCoverageEnabled: b.bool.loose.default(false),
    count: GPUSize32.default(1),
    mask: GPUSampleMask.default(0xffffffff),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUCullMode = b.enumeration(["none", "front", "back"]);
export const GPUFrontFace = b.enumeration(["ccw", "cw"]);
export const GPUIndexFormat = b.enumeration(["uint16", "uint32"]);
export const GPUPrimitiveTopology = b.enumeration([
  "point-list",
  "line-list",
  "line-strip",
  "triangle-list",
  "triangle-strip",
]);
export const GPUPrimitiveState = b.dictionary(
  {
    cullMode: GPUCullMode.default("none"),
    frontFace: GPUFrontFace.default("ccw"),
    stripIndexFormat: GPUIndexFormat.optional,
    topology: GPUPrimitiveTopology.default("triangle-list"),
    unclippedDepth: b.bool.loose.default(false),
  },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
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
export const GPUVertexAttribute = b.dictionary(
  { format: GPUVertexFormat, offset: GPUSize64, shaderLocation: GPUIndex32 },
  { allowArray: true },
);
export const GPUVertexStepMode = b.enumeration(["vertex", "instance"]);
export const GPUVertexBufferLayout = b.dictionary(
  { arrayStride: GPUSize64, attributes: b.sequence(GPUVertexAttribute), stepMode: GPUVertexStepMode.default("vertex") },
  { allowArray: true },
);
export const GPUVertexState = b.dictionary(
  {
    constants: b.record(GPUPipelineConstantValue).default({}),
    entryPoint: b.string.loose.utf8.optional,
    module: GPUShaderModule.ref,
    buffers: b.sequence(GPUVertexBufferLayout.nullable).default([]),
  },
  { allowArray: true },
);
export const GPURenderPipelineDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    layout: GPUPipelineLayoutOrAuto,
    depthStencil: GPUDepthStencilState.optional,
    fragment: GPUFragmentState.optional,
    multisample: GPUMultisampleState.default({}),
    primitive: GPUPrimitiveState.default({}),
    vertex: GPUVertexState,
  },
  { allowArray: true },
);
export const GPURenderPipeline = b.class({
  types: typesOf("GPURenderPipeline"),
  rustPath: "crate::webgpu::GPURenderPipeline",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    label: { getter: b.string.usv, setter: true },
    getBindGroupLayout: { args: { index: b.u32.wrap }, returns: GPUBindGroupLayout, capability: "heap" },
  },
});
export const GPUCommandEncoderDescriptor = b.dictionary(
  { label: b.string.usv.default("") },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUColorDict = b.dictionary(
  { a: b.f64.loose.finite, b: b.f64.loose.finite, g: b.f64.loose.finite, r: b.f64.loose.finite },
  { allowArray: true },
);
export const GPUColor = b.union({ sequence: b.sequence(b.f64.loose.finite), dict: GPUColorDict });
export const GPULoadOp = b.enumeration(["load", "clear"]);
export const GPUTextureOrView = b.union({ texture: GPUTexture.ref, view: GPUTextureView.ref });
export const GPUStoreOp = b.enumeration(["store", "discard"]);
export const GPURenderPassColorAttachment = b.dictionary(
  {
    clearValue: GPUColor.optional,
    depthSlice: GPUIntegerCoordinate.optional,
    loadOp: GPULoadOp,
    resolveTarget: GPUTextureOrView.optional,
    storeOp: GPUStoreOp,
    view: GPUTextureOrView,
  },
  { allowArray: true },
);
export const GPURenderPassDepthStencilAttachment = b.dictionary(
  {
    depthClearValue: b.f32.optional,
    depthLoadOp: GPULoadOp.optional,
    depthReadOnly: b.bool.loose.default(false),
    depthStoreOp: GPUStoreOp.optional,
    stencilClearValue: GPUStencilValue.default(0),
    stencilLoadOp: GPULoadOp.optional,
    stencilReadOnly: b.bool.loose.default(false),
    stencilStoreOp: GPUStoreOp.optional,
    view: GPUTextureOrView,
  },
  { allowArray: true },
);
export const GPUQueryType = b.enumeration(["occlusion", "timestamp"]);
export const GPUQuerySet = b.class({
  types: typesOf("GPUQuerySet"),
  rustPath: "crate::webgpu::GPUQuerySet",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: {
    destroy: {},
    type: { getter: GPUQueryType },
    count: { getter: b.u32 },
    label: { getter: b.string.usv, setter: true },
  },
});
export const GPURenderPassTimestampWrites = b.dictionary(
  { beginningOfPassWriteIndex: GPUSize32.optional, endOfPassWriteIndex: GPUSize32.optional, querySet: GPUQuerySet.ref },
  { allowArray: true },
);
export const GPURenderPassDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    colorAttachments: b.sequence(GPURenderPassColorAttachment.nullable),
    depthStencilAttachment: GPURenderPassDepthStencilAttachment.optional,
    maxDrawCount: GPUSize64.default(50000000),
    occlusionQuerySet: GPUQuerySet.ref.optional,
    timestampWrites: GPURenderPassTimestampWrites.optional,
  },
  { allowArray: true },
);
export const GPURenderBundle = b.class({
  types: typesOf("GPURenderBundle"),
  rustPath: "crate::webgpu::GPURenderBundle",
  configurable: true,
  refCounted: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
const GPUBufferDynamicOffset = b.u32.enforceRange();
const GPUSignedOffset32 = b.i32.enforceRange();
export const GPURenderPassEncoder = b.class({
  types: typesOf("GPURenderPassEncoder"),
  rustPath: "crate::webgpu::GPURenderPassEncoder",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    setViewport: { args: { x: b.f32, y: b.f32, width: b.f32, height: b.f32, minDepth: b.f32, maxDepth: b.f32 } },
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
    label: { getter: b.string.usv, setter: true },
    pushDebugGroup: { args: { groupLabel: b.string.loose.utf8 } },
    popDebugGroup: {},
    insertDebugMarker: { args: { markerLabel: b.string.loose.utf8 } },
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
        uses: { dynamicOffsetsData: copied },
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
      uses: { data: copied },
    },
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
  },
});
export const GPUComputePassTimestampWrites = b.dictionary(
  { beginningOfPassWriteIndex: GPUSize32.optional, endOfPassWriteIndex: GPUSize32.optional, querySet: GPUQuerySet.ref },
  { allowArray: true },
);
export const GPUComputePassDescriptor = b.dictionary(
  { label: b.string.usv.default(""), timestampWrites: GPUComputePassTimestampWrites.optional },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUComputePassEncoder = b.class({
  types: typesOf("GPUComputePassEncoder"),
  rustPath: "crate::webgpu::GPUComputePassEncoder",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
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
    label: { getter: b.string.usv, setter: true },
    pushDebugGroup: { args: { groupLabel: b.string.loose.utf8 } },
    popDebugGroup: {},
    insertDebugMarker: { args: { markerLabel: b.string.loose.utf8 } },
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
        uses: { dynamicOffsetsData: copied },
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
      uses: { data: copied },
    },
  },
});
export const GPUTexelCopyBufferInfo = b.dictionary(
  {
    bytesPerRow: GPUSize32.optional,
    offset: GPUSize64.default(0),
    rowsPerImage: GPUSize32.optional,
    buffer: GPUBuffer.ref,
  },
  { allowArray: true },
);
export const GPUCommandBufferDescriptor = b.dictionary(
  { label: b.string.usv.default("") },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPUCommandEncoder = b.class({
  types: typesOf("GPUCommandEncoder"),
  rustPath: "crate::webgpu::GPUCommandEncoder",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    beginRenderPass: {
      args: { descriptor: GPURenderPassDescriptor },
      returns: GPURenderPassEncoder,
      capability: "heap",
      throws: true,
    },
    beginComputePass: {
      args: { descriptor: GPUComputePassDescriptor.default({}) },
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
      args: { descriptor: GPUCommandBufferDescriptor.default({}) },
      returns: GPUCommandBuffer,
      capability: "heap",
    },
    label: { getter: b.string.usv, setter: true },
    pushDebugGroup: { args: { groupLabel: b.string.loose.utf8 } },
    popDebugGroup: {},
    insertDebugMarker: { args: { markerLabel: b.string.loose.utf8 } },
  },
});
export const GPURenderBundleEncoderDescriptor = b.dictionary(
  {
    label: b.string.usv.default(""),
    colorFormats: b.sequence(GPUTextureFormat.nullable),
    depthStencilFormat: GPUTextureFormat.optional,
    sampleCount: GPUSize32.default(1),
    depthReadOnly: b.bool.loose.default(false),
    stencilReadOnly: b.bool.loose.default(false),
  },
  { allowArray: true },
);
export const GPURenderBundleDescriptor = b.dictionary(
  { label: b.string.usv.default("") },
  { allowArray: true, nonObjectAsEmpty: "nullish" },
);
export const GPURenderBundleEncoder = b.class({
  types: typesOf("GPURenderBundleEncoder"),
  rustPath: "crate::webgpu::GPURenderBundleEncoder",
  configurable: true,
  refCounted: true,
  internalFields: ["device"],
  construct: "illegal",
  proto: {
    finish: {
      args: { descriptor: GPURenderBundleDescriptor.default({}) },
      returns: GPURenderBundle,
      capability: "heap",
    },
    label: { getter: b.string.usv, setter: true },
    pushDebugGroup: { args: { groupLabel: b.string.loose.utf8 } },
    popDebugGroup: {},
    insertDebugMarker: { args: { markerLabel: b.string.loose.utf8 } },
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
        uses: { dynamicOffsetsData: copied },
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
      uses: { data: copied },
    },
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
  },
});
export const GPUQuerySetDescriptor = b.dictionary(
  { label: b.string.usv.default(""), count: GPUSize32, type: GPUQueryType },
  { allowArray: true },
);
export const GPUDeviceLostReason = b.enumeration(["unknown", "destroyed"]);
export const GPUDeviceLostInfo = b.class({
  types: typesOf("GPUDeviceLostInfo"),
  rustPath: "crate::webgpu::GPUDeviceLostInfo",
  configurable: true,
  construct: "illegal",
  proto: { reason: { getter: GPUDeviceLostReason }, message: { getter: b.string } },
});
export const GPUErrorFilter = b.enumeration(["validation", "out-of-memory", "internal"]);
export const GPUError = b.class({
  types: typesOf("GPUError"),
  rustPath: "crate::webgpu::GPUError",
  configurable: true,
  final: false,
  construct: "illegal",
  proto: { message: { getter: b.string } },
});
export const GPUDevice = b.class({
  types: typesOf("GPUDevice"),
  rustPath: "crate::webgpu::GPUDevice",
  configurable: true,
  refCounted: true,
  webcoreBase: "EventTarget",
  construct: "illegal",
  proto: {
    features: { getter: GPUSupportedFeatures, cache: true, capability: "heap" },
    limits: { getter: GPUSupportedLimits, cache: true, capability: "heap" },
    adapterInfo: { getter: GPUAdapterInfo, cache: true, capability: "heap" },
    queue: { getter: GPUQueue, cache: true, capability: "heap" },
    destroy: { capability: "js", throws: true },
    createBuffer: { args: { descriptor: GPUBufferDescriptor }, returns: GPUBuffer, capability: "heap", throws: true },
    createTexture: {
      args: { descriptor: GPUTextureDescriptor },
      returns: GPUTexture,
      capability: "heap",
      throws: true,
    },
    createSampler: { args: { descriptor: GPUSamplerDescriptor.default({}) }, returns: GPUSampler, capability: "heap" },
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
      returns: promiseOf(table.instance("GPUComputePipeline")),
      capability: "js",
      throws: true,
      rejects: true,
    },
    createRenderPipelineAsync: {
      args: { descriptor: GPURenderPipelineDescriptor },
      returns: promiseOf(table.instance("GPURenderPipeline")),
      capability: "js",
      throws: true,
      rejects: true,
    },
    createCommandEncoder: {
      args: { descriptor: GPUCommandEncoderDescriptor.default({}) },
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
    label: { getter: b.string.usv, setter: true },
    lost: { getter: promiseOf(table.instance("GPUDeviceLostInfo")), cache: true, capability: "js" },
    pushErrorScope: { args: { filter: GPUErrorFilter } },
    popErrorScope: {
      returns: promiseOf(table.instance("GPUError").or(table.strictNull)),
      capability: "js",
      throws: true,
      rejects: true,
    },
    onuncapturederror: { eventHandler: "uncapturederror" },
  },
});
export const GPUAdapter = b.class({
  types: typesOf("GPUAdapter"),
  rustPath: "crate::webgpu::GPUAdapter",
  configurable: true,
  construct: "illegal",
  proto: {
    features: { getter: GPUSupportedFeatures, cache: true, capability: "heap" },
    limits: { getter: GPUSupportedLimits, cache: true, capability: "heap" },
    info: { getter: GPUAdapterInfo, cache: true, capability: "heap" },
    requestDevice: {
      args: { descriptor: GPUDeviceDescriptor.default({}) },
      returns: promiseOf(table.instance("GPUDevice")),
      capability: "js",
      throws: true,
      rejects: true,
      uses: { this: [table.retained, ...madeByDevice] },
    },
  },
});
export const GPU = b.class({
  types: typesOf("GPU"),
  rustPath: "crate::webgpu::GPU",
  configurable: true,
  construct: "illegal",
  proto: {
    requestAdapter: {
      args: { options: GPURequestAdapterOptions.default({}) },
      returns: promiseOf(table.instance("GPUAdapter").or(table.strictNull)),
      capability: "js",
      throws: true,
      rejects: true,
    },
    getPreferredCanvasFormat: { returns: GPUTextureFormat },
    wgslLanguageFeatures: { getter: WGSLLanguageFeatures, cache: true, capability: "heap" },
  },
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
export const GPUExternalTexture = b.class({
  types: typesOf("GPUExternalTexture"),
  rustPath: "crate::webgpu::GPUExternalTexture",
  configurable: true,
  construct: "illegal",
  proto: { label: { getter: b.string.usv, setter: true } },
});
export const GPUShaderStage = b.namespace(
  { VERTEX: { constant: 0x1 }, FRAGMENT: { constant: 0x2 }, COMPUTE: { constant: 0x4 } },
  { toStringTag: true },
);
export const GPUCompilationMessageType = b.enumeration(["error", "warning", "info"]);
export const GPUCompilationMessage = b.class({
  types: typesOf("GPUCompilationMessage"),
  rustPath: "crate::webgpu::GPUCompilationMessage",
  configurable: true,
  construct: "illegal",
  proto: {
    message: { getter: b.string },
    type: { getter: GPUCompilationMessageType },
    lineNum: { getter: b.u64 },
    linePos: { getter: b.u64 },
    offset: { getter: b.u64 },
    length: { getter: b.u64 },
  },
});
export const GPUPipelineErrorReason = b.enumeration(["validation", "internal"]);
export const GPUPipelineErrorInit = b.dictionary({ reason: GPUPipelineErrorReason }, { allowArray: true });
export const GPUPipelineError = b.class({
  types: typesOf("GPUPipelineError"),
  rustPath: "crate::webgpu::GPUPipelineError",
  configurable: true,
  refCounted: true,
  webcoreBase: "DOMException",
  construct: { args: { message: b.string.loose.owned.default(""), options: GPUPipelineErrorInit } },
  proto: { reason: { getter: GPUPipelineErrorReason } },
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
export const GPUValidationError = b.class({
  extends: GPUError,
  types: typesOf("GPUValidationError"),
  configurable: true,
  construct: { args: { message: b.string.loose.owned }, requiredArguments: 1, rustName: "new_validation_error" },
  proto: {},
});
export const GPUOutOfMemoryError = b.class({
  extends: GPUError,
  types: typesOf("GPUOutOfMemoryError"),
  configurable: true,
  construct: { args: { message: b.string.loose.owned }, requiredArguments: 1, rustName: "new_out_of_memory_error" },
  proto: {},
});
export const GPUInternalError = b.class({
  extends: GPUError,
  types: typesOf("GPUInternalError"),
  configurable: true,
  construct: { args: { message: b.string.loose.owned }, requiredArguments: 1, rustName: "new_internal_error" },
  proto: {},
});
export const GPUUncapturedErrorEventInit = b.dictionary(
  {
    bubbles: b.bool.loose.default(false),
    cancelable: b.bool.loose.default(false),
    composed: b.bool.loose.default(false),
    error: b.any,
  },
  { allowArray: true },
);
export const GPUUncapturedErrorEvent = b.class({
  types: typesOf("GPUUncapturedErrorEvent"),
  rustPath: "crate::webgpu::GPUUncapturedErrorEvent",
  configurable: true,
  refCounted: true,
  webcoreBase: "Event",
  internalFields: ["error"],
  construct: {
    args: { type: b.string.loose.owned, gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit },
    requiredArguments: 2,
    passStructure: true,
    capability: "heap",
    throws: true,
  },
  proto: { error: { internalField: "error" } },
});

/** For `bun:internal-for-testing`. */
export const useNullBackendForTesting = b.fn({ args: { useIt: b.bool } });
/** Whether Dawn has said that the device of `queue` is lost, which JavaScript only hears from the `GPUDevice`. */
export const isDeviceLostForTesting = b.fn({ args: { queue: GPUQueue }, returns: b.bool });

/** `navigator.gpu`, for ZigGlobalObject.cpp. */
export const createGPU = b.value({ returns: GPU, capability: "heap" });
