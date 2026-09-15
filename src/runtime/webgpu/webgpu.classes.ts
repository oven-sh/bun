import { ClassDefinition, define } from "../../codegen/class-definitions.ts";

type Proto = ClassDefinition["proto"];

const fn = (name: string, length = 0) => ({ fn: name, length });
const get = (name: string) => ({ getter: name });
const cached = (name: string) => ({ getter: name, cache: true as const });

// GPUObjectBase
const label: Proto = { label: { getter: "getLabel", setter: "setLabel" } };

// GPUDebugCommandsMixin
const debugCommands: Proto = {
  pushDebugGroup: fn("pushDebugGroup", 1),
  popDebugGroup: fn("popDebugGroup", 0),
  insertDebugMarker: fn("insertDebugMarker", 1),
};

// GPUBindingCommandsMixin
const bindingCommands: Proto = {
  setBindGroup: fn("setBindGroup", 2),
};

// GPURenderCommandsMixin
const renderCommands: Proto = {
  setPipeline: fn("setPipeline", 1),
  setIndexBuffer: fn("setIndexBuffer", 2),
  setVertexBuffer: fn("setVertexBuffer", 2),
  draw: fn("draw", 1),
  drawIndexed: fn("drawIndexed", 1),
  drawIndirect: fn("drawIndirect", 2),
  drawIndexedIndirect: fn("drawIndexedIndirect", 2),
};

// Every class is a global whose constructor throws: instances only come from WebGPU calls.
function gpu(name: string, proto: Proto, extra: Partial<ClassDefinition> = {}) {
  return define({
    name,
    construct: true,
    finalize: true,
    // WebIDL: attributes and operations are configurable.
    configurable: true,
    klass: {},
    JSType: "0b11101110",
    proto,
    ...extra,
  });
}

export default [
  gpu("GPU", {
    requestAdapter: fn("requestAdapter", 0),
    getPreferredCanvasFormat: fn("getPreferredCanvasFormat", 0),
    wgslLanguageFeatures: cached("getWgslLanguageFeatures"),
  }),

  gpu("GPUAdapter", {
    features: cached("getFeatures"),
    limits: cached("getLimits"),
    info: cached("getInfo"),
    requestDevice: fn("requestDevice", 0),
  }),

  // The native half of GPUDevice. The public class is JS (src/js/internal/webgpu.ts) to extend EventTarget.
  gpu(
    "GPUDeviceHandle",
    {
      ...label,
      features: cached("getFeatures"),
      limits: cached("getLimits"),
      adapterInfo: cached("getAdapterInfo"),
      queue: cached("getQueue"),
      lost: cached("getLost"),
      destroy: fn("destroy", 0),
      createBuffer: fn("createBuffer", 1),
      createTexture: fn("createTexture", 1),
      createSampler: fn("createSampler", 0),
      createBindGroupLayout: fn("createBindGroupLayout", 1),
      createPipelineLayout: fn("createPipelineLayout", 1),
      createBindGroup: fn("createBindGroup", 1),
      createShaderModule: fn("createShaderModule", 1),
      createComputePipeline: fn("createComputePipeline", 1),
      createRenderPipeline: fn("createRenderPipeline", 1),
      createComputePipelineAsync: fn("createComputePipelineAsync", 1),
      createRenderPipelineAsync: fn("createRenderPipelineAsync", 1),
      createCommandEncoder: fn("createCommandEncoder", 0),
      createRenderBundleEncoder: fn("createRenderBundleEncoder", 1),
      createQuerySet: fn("createQuerySet", 1),
      pushErrorScope: fn("pushErrorScope", 1),
      popErrorScope: fn("popErrorScope", 0),
      setErrorHandler: { fn: "setErrorHandler", length: 1, passThis: true },
    },
    { values: ["errorHandler"] },
  ),

  gpu("GPUQueue", {
    ...label,
    submit: fn("submit", 1),
    onSubmittedWorkDone: fn("onSubmittedWorkDone", 0),
    writeBuffer: fn("writeBuffer", 3),
    writeTexture: fn("writeTexture", 4),
  }),

  gpu(
    "GPUBuffer",
    {
      ...label,
      size: get("getSize"),
      usage: get("getUsage"),
      mapState: get("getMapState"),
      mapAsync: { fn: "mapAsync", length: 1, passThis: true },
      getMappedRange: { fn: "getMappedRange", length: 0, passThis: true },
      unmap: { fn: "unmap", length: 0, passThis: true },
      destroy: { fn: "destroy", length: 0, passThis: true },
    },
    // The GPU allocation is invisible to the collector: report it so dropped wrappers get collected.
    { values: ["mappedRanges", "pendingMap"], estimatedSize: true },
  ),

  gpu(
    "GPUTexture",
    {
      ...label,
      createView: fn("createView", 0),
      destroy: fn("destroy", 0),
      width: get("getWidth"),
      height: get("getHeight"),
      depthOrArrayLayers: get("getDepthOrArrayLayers"),
      mipLevelCount: get("getMipLevelCount"),
      sampleCount: get("getSampleCount"),
      dimension: get("getDimension"),
      format: get("getFormat"),
      usage: get("getUsage"),
    },
    { estimatedSize: true },
  ),

  gpu("GPUTextureView", { ...label }),
  gpu("GPUSampler", { ...label }),
  gpu("GPUBindGroupLayout", { ...label }),
  gpu("GPUPipelineLayout", { ...label }),
  gpu("GPUBindGroup", { ...label }),

  gpu("GPUShaderModule", {
    ...label,
    getCompilationInfo: fn("getCompilationInfo", 0),
  }),

  gpu("GPUComputePipeline", {
    ...label,
    getBindGroupLayout: fn("getBindGroupLayout", 1),
  }),

  gpu("GPURenderPipeline", {
    ...label,
    getBindGroupLayout: fn("getBindGroupLayout", 1),
  }),

  gpu("GPUCommandEncoder", {
    ...label,
    ...debugCommands,
    beginRenderPass: fn("beginRenderPass", 1),
    beginComputePass: fn("beginComputePass", 0),
    copyBufferToBuffer: fn("copyBufferToBuffer", 2),
    copyBufferToTexture: fn("copyBufferToTexture", 3),
    copyTextureToBuffer: fn("copyTextureToBuffer", 3),
    copyTextureToTexture: fn("copyTextureToTexture", 3),
    clearBuffer: fn("clearBuffer", 1),
    resolveQuerySet: fn("resolveQuerySet", 5),
    finish: fn("finish", 0),
  }),

  gpu("GPUCommandBuffer", { ...label }),

  gpu("GPUComputePassEncoder", {
    ...label,
    ...debugCommands,
    ...bindingCommands,
    setPipeline: fn("setPipeline", 1),
    dispatchWorkgroups: fn("dispatchWorkgroups", 1),
    dispatchWorkgroupsIndirect: fn("dispatchWorkgroupsIndirect", 2),
    end: fn("end", 0),
  }),

  gpu("GPURenderPassEncoder", {
    ...label,
    ...debugCommands,
    ...bindingCommands,
    ...renderCommands,
    setViewport: fn("setViewport", 6),
    setScissorRect: fn("setScissorRect", 4),
    setBlendConstant: fn("setBlendConstant", 1),
    setStencilReference: fn("setStencilReference", 1),
    beginOcclusionQuery: fn("beginOcclusionQuery", 1),
    endOcclusionQuery: fn("endOcclusionQuery", 0),
    executeBundles: fn("executeBundles", 1),
    end: fn("end", 0),
  }),

  gpu("GPURenderBundleEncoder", {
    ...label,
    ...debugCommands,
    ...bindingCommands,
    ...renderCommands,
    finish: fn("finish", 0),
  }),

  gpu("GPURenderBundle", { ...label }),

  gpu("GPUQuerySet", {
    ...label,
    destroy: fn("destroy", 0),
    type: get("getType"),
    count: get("getCount"),
  }),
];
