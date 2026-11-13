// Written by src/codegen/generate-webgpu-bindings.ts, from src/runtime/webgpu/webgpu.idl.

declare module "bun" {
  namespace __internal {
    /** `lib.dom.d.ts` or `@webgpu/types` is loaded. Both have `GPUCanvasContext`, which Bun does not. */
    type LibEmptyOrWebGPU<T> = typeof globalThis extends { GPUCanvasContext: any } ? {} : T;
    /** `Otherwise` is what `@webgpu/types` declares, which can come after this file and so cannot be inferred from. */
    type UseLibDomWebGPUIfAvailable<Name extends PropertyKey, Otherwise> = typeof globalThis extends {
      GPUCanvasContext: { new (): infer Context };
    }
      ? [Context] extends [never]
        ? Otherwise
        : UseLibDomIfAvailable<Name, Otherwise>
      : Otherwise;
  }

  /**
   * [WebGPU](https://gpuweb.github.io/gpuweb/), without what needs a window or a DOM. The interfaces are globals too.
   */
  namespace WebGPU {
    interface GPUSupportedLimits {
      readonly maxTextureDimension1D: number;
      readonly maxTextureDimension2D: number;
      readonly maxTextureDimension3D: number;
      readonly maxTextureArrayLayers: number;
      readonly maxBindGroups: number;
      readonly maxBindGroupsPlusVertexBuffers: number;
      readonly maxImmediateSize: number;
      readonly maxBindingsPerBindGroup: number;
      readonly maxDynamicUniformBuffersPerPipelineLayout: number;
      readonly maxDynamicStorageBuffersPerPipelineLayout: number;
      readonly maxSampledTexturesPerShaderStage: number;
      readonly maxSamplersPerShaderStage: number;
      readonly maxStorageBuffersPerShaderStage: number;
      readonly maxStorageBuffersInVertexStage: number;
      readonly maxStorageBuffersInFragmentStage: number;
      readonly maxStorageTexturesPerShaderStage: number;
      readonly maxStorageTexturesInVertexStage: number;
      readonly maxStorageTexturesInFragmentStage: number;
      readonly maxUniformBuffersPerShaderStage: number;
      readonly maxUniformBufferBindingSize: number;
      readonly maxStorageBufferBindingSize: number;
      readonly minUniformBufferOffsetAlignment: number;
      readonly minStorageBufferOffsetAlignment: number;
      readonly maxVertexBuffers: number;
      readonly maxBufferSize: number;
      readonly maxVertexAttributes: number;
      readonly maxVertexBufferArrayStride: number;
      readonly maxInterStageShaderVariables: number;
      readonly maxColorAttachments: number;
      readonly maxColorAttachmentBytesPerSample: number;
      readonly maxComputeWorkgroupStorageSize: number;
      readonly maxComputeInvocationsPerWorkgroup: number;
      readonly maxComputeWorkgroupSizeX: number;
      readonly maxComputeWorkgroupSizeY: number;
      readonly maxComputeWorkgroupSizeZ: number;
      readonly maxComputeWorkgroupsPerDimension: number;
    }
    interface GPUSupportedFeatures extends ReadonlySet<string> {}
    interface WGSLLanguageFeatures extends ReadonlySet<string> {}
    interface GPUAdapterInfo {
      readonly vendor: string;
      readonly architecture: string;
      readonly device: string;
      readonly description: string;
      readonly subgroupMinSize: number;
      readonly subgroupMaxSize: number;
      readonly isFallbackAdapter: boolean;
    }
    interface GPU {
      requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
      getPreferredCanvasFormat(): GPUTextureFormat;
      readonly wgslLanguageFeatures: WGSLLanguageFeatures;
    }
    interface GPURequestAdapterOptions {
      featureLevel?: string | undefined;
      powerPreference?: GPUPowerPreference | undefined;
      forceFallbackAdapter?: boolean | undefined;
      xrCompatible?: boolean | undefined;
    }
    type GPUPowerPreference = "low-power" | "high-performance";
    interface GPUAdapter {
      readonly features: GPUSupportedFeatures;
      readonly limits: GPUSupportedLimits;
      readonly info: GPUAdapterInfo;
      requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    }
    interface GPUDeviceDescriptor extends GPUObjectDescriptorBase {
      requiredFeatures?: Iterable<GPUFeatureName> | undefined;
      requiredLimits?: Record<string, GPUSize64 | undefined> | undefined;
      defaultQueue?: GPUQueueDescriptor | undefined;
    }
    interface GPUObjectDescriptorBase {
      label?: string | undefined;
    }
    type GPUFeatureName =
      | "core-features-and-limits"
      | "depth-clip-control"
      | "depth32float-stencil8"
      | "texture-compression-bc"
      | "texture-compression-bc-sliced-3d"
      | "texture-compression-etc2"
      | "texture-compression-astc"
      | "texture-compression-astc-sliced-3d"
      | "timestamp-query"
      | "indirect-first-instance"
      | "shader-f16"
      | "rg11b10ufloat-renderable"
      | "bgra8unorm-storage"
      | "float32-filterable"
      | "float32-blendable"
      | "clip-distances"
      | "dual-source-blending"
      | "subgroups"
      | "texture-formats-tier1"
      | "texture-formats-tier2"
      | "primitive-index"
      | "texture-component-swizzle"
      | "subgroup-size-control"
      | "texture-compression-unaligned"
      | "atomic-vec2u-min-max";
    type GPUSize64 = number;
    interface GPUQueueDescriptor extends GPUObjectDescriptorBase {}
    interface GPUDevice extends EventTarget {
      readonly features: GPUSupportedFeatures;
      readonly limits: GPUSupportedLimits;
      readonly adapterInfo: GPUAdapterInfo;
      readonly queue: GPUQueue;
      destroy(): undefined;
      createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
      createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
      createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
      createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
      createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
      createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
      createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
      createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
      createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
      createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
      createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
      createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
      createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder;
      createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
      label: string;
      readonly lost: Promise<GPUDeviceLostInfo>;
      pushErrorScope(filter: GPUErrorFilter): undefined;
      popErrorScope(): Promise<GPUError | null>;
      onuncapturederror: ((this: GPUDevice, event: GPUUncapturedErrorEvent) => any) | null;
      addEventListener(
        type: "uncapturederror",
        listener: (this: GPUDevice, event: GPUUncapturedErrorEvent) => any,
        options?: boolean | AddEventListenerOptions,
      ): void;
      addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void;
      removeEventListener(
        type: "uncapturederror",
        listener: (this: GPUDevice, event: GPUUncapturedErrorEvent) => any,
        options?: boolean | EventListenerOptions,
      ): void;
      removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void;
    }
    interface GPUQueue {
      submit(commandBuffers: Iterable<GPUCommandBuffer>): undefined;
      onSubmittedWorkDone(): Promise<undefined>;
      writeBuffer(
        buffer: GPUBuffer,
        bufferOffset: GPUSize64,
        data: Bun.BufferSource,
        dataOffset?: GPUSize64,
        size?: GPUSize64,
      ): undefined;
      writeTexture(
        destination: GPUTexelCopyTextureInfo,
        data: Bun.BufferSource,
        dataLayout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      ): undefined;
      label: string;
    }
    interface GPUCommandBuffer {
      label: string;
    }
    interface GPUBuffer {
      readonly size: GPUSize64Out;
      readonly usage: GPUFlagsConstant;
      readonly mapState: GPUBufferMapState;
      mapAsync(mode: GPUMapModeFlags, offset?: GPUSize64, size?: GPUSize64): Promise<undefined>;
      getMappedRange(offset?: GPUSize64, size?: GPUSize64): ArrayBuffer;
      unmap(): undefined;
      destroy(): undefined;
      label: string;
    }
    type GPUSize64Out = number;
    type GPUFlagsConstant = number;
    type GPUBufferMapState = "unmapped" | "pending" | "mapped";
    type GPUMapModeFlags = number;
    interface GPUTexelCopyTextureInfo {
      texture: GPUTexture;
      mipLevel?: GPUIntegerCoordinate | undefined;
      origin?: GPUOrigin3D | undefined;
      aspect?: GPUTextureAspect | undefined;
    }
    interface GPUTexture {
      createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
      destroy(): undefined;
      readonly width: GPUIntegerCoordinateOut;
      readonly height: GPUIntegerCoordinateOut;
      readonly depthOrArrayLayers: GPUIntegerCoordinateOut;
      readonly mipLevelCount: GPUIntegerCoordinateOut;
      readonly sampleCount: GPUSize32Out;
      readonly dimension: GPUTextureDimension;
      readonly format: GPUTextureFormat;
      readonly usage: GPUFlagsConstant;
      readonly textureBindingViewDimension: GPUTextureViewDimension | undefined;
      label: string;
    }
    interface GPUTextureViewDescriptor extends GPUObjectDescriptorBase {
      format?: GPUTextureFormat | undefined;
      dimension?: GPUTextureViewDimension | undefined;
      usage?: GPUTextureUsageFlags | undefined;
      aspect?: GPUTextureAspect | undefined;
      baseMipLevel?: GPUIntegerCoordinate | undefined;
      mipLevelCount?: GPUIntegerCoordinate | undefined;
      baseArrayLayer?: GPUIntegerCoordinate | undefined;
      arrayLayerCount?: GPUIntegerCoordinate | undefined;
      swizzle?: string | undefined;
    }
    type GPUTextureFormat =
      | "r8unorm"
      | "r8snorm"
      | "r8uint"
      | "r8sint"
      | "r16unorm"
      | "r16snorm"
      | "r16uint"
      | "r16sint"
      | "r16float"
      | "rg8unorm"
      | "rg8snorm"
      | "rg8uint"
      | "rg8sint"
      | "r32uint"
      | "r32sint"
      | "r32float"
      | "rg16unorm"
      | "rg16snorm"
      | "rg16uint"
      | "rg16sint"
      | "rg16float"
      | "rgba8unorm"
      | "rgba8unorm-srgb"
      | "rgba8snorm"
      | "rgba8uint"
      | "rgba8sint"
      | "bgra8unorm"
      | "bgra8unorm-srgb"
      | "rgb9e5ufloat"
      | "rgb10a2uint"
      | "rgb10a2unorm"
      | "rg11b10ufloat"
      | "rg32uint"
      | "rg32sint"
      | "rg32float"
      | "rgba16unorm"
      | "rgba16snorm"
      | "rgba16uint"
      | "rgba16sint"
      | "rgba16float"
      | "rgba32uint"
      | "rgba32sint"
      | "rgba32float"
      | "stencil8"
      | "depth16unorm"
      | "depth24plus"
      | "depth24plus-stencil8"
      | "depth32float"
      | "depth32float-stencil8"
      | "bc1-rgba-unorm"
      | "bc1-rgba-unorm-srgb"
      | "bc2-rgba-unorm"
      | "bc2-rgba-unorm-srgb"
      | "bc3-rgba-unorm"
      | "bc3-rgba-unorm-srgb"
      | "bc4-r-unorm"
      | "bc4-r-snorm"
      | "bc5-rg-unorm"
      | "bc5-rg-snorm"
      | "bc6h-rgb-ufloat"
      | "bc6h-rgb-float"
      | "bc7-rgba-unorm"
      | "bc7-rgba-unorm-srgb"
      | "etc2-rgb8unorm"
      | "etc2-rgb8unorm-srgb"
      | "etc2-rgb8a1unorm"
      | "etc2-rgb8a1unorm-srgb"
      | "etc2-rgba8unorm"
      | "etc2-rgba8unorm-srgb"
      | "eac-r11unorm"
      | "eac-r11snorm"
      | "eac-rg11unorm"
      | "eac-rg11snorm"
      | "astc-4x4-unorm"
      | "astc-4x4-unorm-srgb"
      | "astc-5x4-unorm"
      | "astc-5x4-unorm-srgb"
      | "astc-5x5-unorm"
      | "astc-5x5-unorm-srgb"
      | "astc-6x5-unorm"
      | "astc-6x5-unorm-srgb"
      | "astc-6x6-unorm"
      | "astc-6x6-unorm-srgb"
      | "astc-8x5-unorm"
      | "astc-8x5-unorm-srgb"
      | "astc-8x6-unorm"
      | "astc-8x6-unorm-srgb"
      | "astc-8x8-unorm"
      | "astc-8x8-unorm-srgb"
      | "astc-10x5-unorm"
      | "astc-10x5-unorm-srgb"
      | "astc-10x6-unorm"
      | "astc-10x6-unorm-srgb"
      | "astc-10x8-unorm"
      | "astc-10x8-unorm-srgb"
      | "astc-10x10-unorm"
      | "astc-10x10-unorm-srgb"
      | "astc-12x10-unorm"
      | "astc-12x10-unorm-srgb"
      | "astc-12x12-unorm"
      | "astc-12x12-unorm-srgb";
    type GPUTextureViewDimension = "1d" | "2d" | "2d-array" | "cube" | "cube-array" | "3d";
    type GPUTextureUsageFlags = number;
    type GPUTextureAspect = "all" | "stencil-only" | "depth-only";
    type GPUIntegerCoordinate = number;
    interface GPUTextureView {
      label: string;
    }
    type GPUIntegerCoordinateOut = number;
    type GPUSize32Out = number;
    type GPUTextureDimension = "1d" | "2d" | "3d";
    type GPUOrigin3D = Iterable<GPUIntegerCoordinate> | GPUOrigin3DDict;
    interface GPUOrigin3DDict {
      x?: GPUIntegerCoordinate | undefined;
      y?: GPUIntegerCoordinate | undefined;
      z?: GPUIntegerCoordinate | undefined;
    }
    interface GPUTexelCopyBufferLayout {
      offset?: GPUSize64 | undefined;
      bytesPerRow?: GPUSize32 | undefined;
      rowsPerImage?: GPUSize32 | undefined;
    }
    type GPUSize32 = number;
    type GPUExtent3D = Iterable<GPUIntegerCoordinate> | GPUExtent3DDict;
    interface GPUExtent3DDict {
      width: GPUIntegerCoordinate;
      height?: GPUIntegerCoordinate | undefined;
      depthOrArrayLayers?: GPUIntegerCoordinate | undefined;
    }
    interface GPUBufferDescriptor extends GPUObjectDescriptorBase {
      size: GPUSize64;
      usage: GPUBufferUsageFlags;
      mappedAtCreation?: boolean | undefined;
    }
    type GPUBufferUsageFlags = number;
    interface GPUTextureDescriptor extends GPUObjectDescriptorBase {
      size: GPUExtent3D;
      mipLevelCount?: GPUIntegerCoordinate | undefined;
      sampleCount?: GPUSize32 | undefined;
      dimension?: GPUTextureDimension | undefined;
      format: GPUTextureFormat;
      usage: GPUTextureUsageFlags;
      viewFormats?: Iterable<GPUTextureFormat> | undefined;
      textureBindingViewDimension?: GPUTextureViewDimension | undefined;
    }
    interface GPUSamplerDescriptor extends GPUObjectDescriptorBase {
      addressModeU?: GPUAddressMode | undefined;
      addressModeV?: GPUAddressMode | undefined;
      addressModeW?: GPUAddressMode | undefined;
      magFilter?: GPUFilterMode | undefined;
      minFilter?: GPUFilterMode | undefined;
      mipmapFilter?: GPUMipmapFilterMode | undefined;
      lodMinClamp?: number | undefined;
      lodMaxClamp?: number | undefined;
      compare?: GPUCompareFunction | undefined;
      maxAnisotropy?: number | undefined;
    }
    type GPUAddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";
    type GPUFilterMode = "nearest" | "linear";
    type GPUMipmapFilterMode = "nearest" | "linear";
    type GPUCompareFunction =
      "never" | "less" | "equal" | "less-equal" | "greater" | "not-equal" | "greater-equal" | "always";
    interface GPUSampler {
      label: string;
    }
    interface GPUBindGroupLayoutDescriptor extends GPUObjectDescriptorBase {
      entries: Iterable<GPUBindGroupLayoutEntry>;
    }
    interface GPUBindGroupLayoutEntry {
      binding: GPUIndex32;
      visibility: GPUShaderStageFlags;
      buffer?: GPUBufferBindingLayout | undefined;
      sampler?: GPUSamplerBindingLayout | undefined;
      texture?: GPUTextureBindingLayout | undefined;
      storageTexture?: GPUStorageTextureBindingLayout | undefined;
      externalTexture?: GPUExternalTextureBindingLayout | undefined;
    }
    type GPUIndex32 = number;
    type GPUShaderStageFlags = number;
    interface GPUBufferBindingLayout {
      type?: GPUBufferBindingType | undefined;
      hasDynamicOffset?: boolean | undefined;
      minBindingSize?: GPUSize64 | undefined;
    }
    type GPUBufferBindingType = "uniform" | "storage" | "read-only-storage";
    interface GPUSamplerBindingLayout {
      type?: GPUSamplerBindingType | undefined;
    }
    type GPUSamplerBindingType = "filtering" | "non-filtering" | "comparison";
    interface GPUTextureBindingLayout {
      sampleType?: GPUTextureSampleType | undefined;
      viewDimension?: GPUTextureViewDimension | undefined;
      multisampled?: boolean | undefined;
    }
    type GPUTextureSampleType = "float" | "unfilterable-float" | "depth" | "sint" | "uint";
    interface GPUStorageTextureBindingLayout {
      access?: GPUStorageTextureAccess | undefined;
      format: GPUTextureFormat;
      viewDimension?: GPUTextureViewDimension | undefined;
    }
    type GPUStorageTextureAccess = "write-only" | "read-only" | "read-write";
    interface GPUExternalTextureBindingLayout {}
    interface GPUBindGroupLayout {
      label: string;
    }
    interface GPUPipelineLayoutDescriptor extends GPUObjectDescriptorBase {
      bindGroupLayouts: Iterable<GPUBindGroupLayout | null>;
      immediateSize?: GPUSize32 | undefined;
    }
    interface GPUPipelineLayout {
      label: string;
    }
    interface GPUBindGroupDescriptor extends GPUObjectDescriptorBase {
      layout: GPUBindGroupLayout;
      entries: Iterable<GPUBindGroupEntry>;
    }
    interface GPUBindGroupEntry {
      binding: GPUIndex32;
      resource: GPUBindingResource;
    }
    type GPUBindingResource = GPUSampler | GPUTexture | GPUTextureView | GPUBuffer | GPUBufferBinding;
    interface GPUBufferBinding {
      buffer: GPUBuffer;
      offset?: GPUSize64 | undefined;
      size?: GPUSize64 | undefined;
    }
    interface GPUBindGroup {
      label: string;
    }
    interface GPUShaderModuleDescriptor extends GPUObjectDescriptorBase {
      code: string;
      compilationHints?: Iterable<GPUShaderModuleCompilationHint> | undefined;
    }
    interface GPUShaderModuleCompilationHint {
      entryPoint: string;
      layout?: GPUPipelineLayout | GPUAutoLayoutMode | undefined;
    }
    type GPUAutoLayoutMode = "auto";
    interface GPUShaderModule {
      getCompilationInfo(): Promise<GPUCompilationInfo>;
      label: string;
    }
    interface GPUCompilationInfo {
      readonly messages: ReadonlyArray<GPUCompilationMessage>;
    }
    interface GPUCompilationMessage {
      readonly message: string;
      readonly type: GPUCompilationMessageType;
      readonly lineNum: number;
      readonly linePos: number;
      readonly offset: number;
      readonly length: number;
    }
    type GPUCompilationMessageType = "error" | "warning" | "info";
    interface GPUComputePipelineDescriptor extends GPUPipelineDescriptorBase {
      compute: GPUProgrammableStage;
    }
    interface GPUPipelineDescriptorBase extends GPUObjectDescriptorBase {
      layout: GPUPipelineLayout | GPUAutoLayoutMode;
    }
    interface GPUProgrammableStage {
      module: GPUShaderModule;
      entryPoint?: string | undefined;
      constants?: Record<string, GPUPipelineConstantValue> | undefined;
    }
    type GPUPipelineConstantValue = number;
    interface GPUComputePipeline {
      label: string;
      getBindGroupLayout(index: number): GPUBindGroupLayout;
    }
    interface GPURenderPipelineDescriptor extends GPUPipelineDescriptorBase {
      vertex: GPUVertexState;
      primitive?: GPUPrimitiveState | undefined;
      depthStencil?: GPUDepthStencilState | undefined;
      multisample?: GPUMultisampleState | undefined;
      fragment?: GPUFragmentState | undefined;
    }
    interface GPUVertexState extends GPUProgrammableStage {
      buffers?: Iterable<GPUVertexBufferLayout | null> | undefined;
    }
    interface GPUVertexBufferLayout {
      arrayStride: GPUSize64;
      stepMode?: GPUVertexStepMode | undefined;
      attributes: Iterable<GPUVertexAttribute>;
    }
    type GPUVertexStepMode = "vertex" | "instance";
    interface GPUVertexAttribute {
      format: GPUVertexFormat;
      offset: GPUSize64;
      shaderLocation: GPUIndex32;
    }
    type GPUVertexFormat =
      | "uint8"
      | "uint8x2"
      | "uint8x4"
      | "sint8"
      | "sint8x2"
      | "sint8x4"
      | "unorm8"
      | "unorm8x2"
      | "unorm8x4"
      | "snorm8"
      | "snorm8x2"
      | "snorm8x4"
      | "uint16"
      | "uint16x2"
      | "uint16x4"
      | "sint16"
      | "sint16x2"
      | "sint16x4"
      | "unorm16"
      | "unorm16x2"
      | "unorm16x4"
      | "snorm16"
      | "snorm16x2"
      | "snorm16x4"
      | "float16"
      | "float16x2"
      | "float16x4"
      | "float32"
      | "float32x2"
      | "float32x3"
      | "float32x4"
      | "uint32"
      | "uint32x2"
      | "uint32x3"
      | "uint32x4"
      | "sint32"
      | "sint32x2"
      | "sint32x3"
      | "sint32x4"
      | "unorm10-10-10-2"
      | "unorm8x4-bgra"
      | "snorm10-10-10-2";
    interface GPUPrimitiveState {
      topology?: GPUPrimitiveTopology | undefined;
      stripIndexFormat?: GPUIndexFormat | undefined;
      frontFace?: GPUFrontFace | undefined;
      cullMode?: GPUCullMode | undefined;
      unclippedDepth?: boolean | undefined;
    }
    type GPUPrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";
    type GPUIndexFormat = "uint16" | "uint32";
    type GPUFrontFace = "ccw" | "cw";
    type GPUCullMode = "none" | "front" | "back";
    interface GPUDepthStencilState {
      format: GPUTextureFormat;
      depthWriteEnabled?: boolean | undefined;
      depthCompare?: GPUCompareFunction | undefined;
      stencilFront?: GPUStencilFaceState | undefined;
      stencilBack?: GPUStencilFaceState | undefined;
      stencilReadMask?: GPUStencilValue | undefined;
      stencilWriteMask?: GPUStencilValue | undefined;
      depthBias?: GPUDepthBias | undefined;
      depthBiasSlopeScale?: number | undefined;
      depthBiasClamp?: number | undefined;
    }
    interface GPUStencilFaceState {
      compare?: GPUCompareFunction | undefined;
      failOp?: GPUStencilOperation | undefined;
      depthFailOp?: GPUStencilOperation | undefined;
      passOp?: GPUStencilOperation | undefined;
    }
    type GPUStencilOperation =
      | "keep"
      | "zero"
      | "replace"
      | "invert"
      | "increment-clamp"
      | "decrement-clamp"
      | "increment-wrap"
      | "decrement-wrap";
    type GPUStencilValue = number;
    type GPUDepthBias = number;
    interface GPUMultisampleState {
      count?: GPUSize32 | undefined;
      mask?: GPUSampleMask | undefined;
      alphaToCoverageEnabled?: boolean | undefined;
    }
    type GPUSampleMask = number;
    interface GPUFragmentState extends GPUProgrammableStage {
      targets: Iterable<GPUColorTargetState | null>;
    }
    interface GPUColorTargetState {
      format: GPUTextureFormat;
      blend?: GPUBlendState | undefined;
      writeMask?: GPUColorWriteFlags | undefined;
    }
    interface GPUBlendState {
      color: GPUBlendComponent;
      alpha: GPUBlendComponent;
    }
    interface GPUBlendComponent {
      operation?: GPUBlendOperation | undefined;
      srcFactor?: GPUBlendFactor | undefined;
      dstFactor?: GPUBlendFactor | undefined;
    }
    type GPUBlendOperation = "add" | "subtract" | "reverse-subtract" | "min" | "max";
    type GPUBlendFactor =
      | "zero"
      | "one"
      | "src"
      | "one-minus-src"
      | "src-alpha"
      | "one-minus-src-alpha"
      | "dst"
      | "one-minus-dst"
      | "dst-alpha"
      | "one-minus-dst-alpha"
      | "src-alpha-saturated"
      | "constant"
      | "one-minus-constant"
      | "src1"
      | "one-minus-src1"
      | "src1-alpha"
      | "one-minus-src1-alpha";
    type GPUColorWriteFlags = number;
    interface GPURenderPipeline {
      label: string;
      getBindGroupLayout(index: number): GPUBindGroupLayout;
    }
    interface GPUCommandEncoderDescriptor extends GPUObjectDescriptorBase {}
    interface GPUCommandEncoder {
      beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
      beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
      copyBufferToBuffer(source: GPUBuffer, destination: GPUBuffer, size?: GPUSize64): undefined;
      copyBufferToBuffer(
        source: GPUBuffer,
        sourceOffset: GPUSize64,
        destination: GPUBuffer,
        destinationOffset: GPUSize64,
        size?: GPUSize64,
      ): undefined;
      copyBufferToTexture(
        source: GPUTexelCopyBufferInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3D,
      ): undefined;
      copyTextureToBuffer(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        copySize: GPUExtent3D,
      ): undefined;
      copyTextureToTexture(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3D,
      ): undefined;
      clearBuffer(buffer: GPUBuffer, offset?: GPUSize64, size?: GPUSize64): undefined;
      resolveQuerySet(
        querySet: GPUQuerySet,
        firstQuery: GPUSize32,
        queryCount: GPUSize32,
        destination: GPUBuffer,
        destinationOffset: GPUSize64,
      ): undefined;
      finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
      label: string;
      pushDebugGroup(groupLabel: string): undefined;
      popDebugGroup(): undefined;
      insertDebugMarker(markerLabel: string): undefined;
    }
    interface GPURenderPassDescriptor extends GPUObjectDescriptorBase {
      colorAttachments: Iterable<GPURenderPassColorAttachment | null>;
      depthStencilAttachment?: GPURenderPassDepthStencilAttachment | undefined;
      occlusionQuerySet?: GPUQuerySet | undefined;
      timestampWrites?: GPURenderPassTimestampWrites | undefined;
      maxDrawCount?: GPUSize64 | undefined;
    }
    interface GPURenderPassColorAttachment {
      view: GPUTexture | GPUTextureView;
      depthSlice?: GPUIntegerCoordinate | undefined;
      resolveTarget?: GPUTexture | GPUTextureView | undefined;
      clearValue?: GPUColor | undefined;
      loadOp: GPULoadOp;
      storeOp: GPUStoreOp;
    }
    type GPUColor = Iterable<number> | GPUColorDict;
    interface GPUColorDict {
      r: number;
      g: number;
      b: number;
      a: number;
    }
    type GPULoadOp = "load" | "clear";
    type GPUStoreOp = "store" | "discard";
    interface GPURenderPassDepthStencilAttachment {
      view: GPUTexture | GPUTextureView;
      depthClearValue?: number | undefined;
      depthLoadOp?: GPULoadOp | undefined;
      depthStoreOp?: GPUStoreOp | undefined;
      depthReadOnly?: boolean | undefined;
      stencilClearValue?: GPUStencilValue | undefined;
      stencilLoadOp?: GPULoadOp | undefined;
      stencilStoreOp?: GPUStoreOp | undefined;
      stencilReadOnly?: boolean | undefined;
    }
    interface GPUQuerySet {
      destroy(): undefined;
      readonly type: GPUQueryType;
      readonly count: GPUSize32Out;
      label: string;
    }
    type GPUQueryType = "occlusion" | "timestamp";
    interface GPURenderPassTimestampWrites {
      querySet: GPUQuerySet;
      beginningOfPassWriteIndex?: GPUSize32 | undefined;
      endOfPassWriteIndex?: GPUSize32 | undefined;
    }
    interface GPURenderPassEncoder {
      setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): undefined;
      setScissorRect(
        x: GPUIntegerCoordinate,
        y: GPUIntegerCoordinate,
        width: GPUIntegerCoordinate,
        height: GPUIntegerCoordinate,
      ): undefined;
      setBlendConstant(color: GPUColor): undefined;
      setStencilReference(reference: GPUStencilValue): undefined;
      beginOcclusionQuery(queryIndex: GPUSize32): undefined;
      endOcclusionQuery(): undefined;
      executeBundles(bundles: Iterable<GPURenderBundle>): undefined;
      end(): undefined;
      label: string;
      pushDebugGroup(groupLabel: string): undefined;
      popDebugGroup(): undefined;
      insertDebugMarker(markerLabel: string): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsets?: Iterable<GPUBufferDynamicOffset>,
      ): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsetsData: Uint32Array,
        dynamicOffsetsDataStart: GPUSize64,
        dynamicOffsetsDataLength: GPUSize32,
      ): undefined;
      setImmediates(
        rangeOffset: GPUSize32,
        data: Bun.BufferSource,
        dataOffset?: GPUSize64,
        dataSize?: GPUSize64,
      ): undefined;
      setPipeline(pipeline: GPURenderPipeline): undefined;
      setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: GPUSize64, size?: GPUSize64): undefined;
      setVertexBuffer(slot: GPUIndex32, buffer: GPUBuffer | null, offset?: GPUSize64, size?: GPUSize64): undefined;
      draw(
        vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32,
      ): undefined;
      drawIndexed(
        indexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstIndex?: GPUSize32,
        baseVertex?: GPUSignedOffset32,
        firstInstance?: GPUSize32,
      ): undefined;
      drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: GPUSize64): undefined;
      drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: GPUSize64): undefined;
    }
    interface GPURenderBundle {
      label: string;
    }
    type GPUBufferDynamicOffset = number;
    type GPUSignedOffset32 = number;
    interface GPUComputePassDescriptor extends GPUObjectDescriptorBase {
      timestampWrites?: GPUComputePassTimestampWrites | undefined;
    }
    interface GPUComputePassTimestampWrites {
      querySet: GPUQuerySet;
      beginningOfPassWriteIndex?: GPUSize32 | undefined;
      endOfPassWriteIndex?: GPUSize32 | undefined;
    }
    interface GPUComputePassEncoder {
      setPipeline(pipeline: GPUComputePipeline): undefined;
      dispatchWorkgroups(
        workgroupCountX: GPUSize32,
        workgroupCountY?: GPUSize32,
        workgroupCountZ?: GPUSize32,
      ): undefined;
      dispatchWorkgroupsIndirect(indirectBuffer: GPUBuffer, indirectOffset: GPUSize64): undefined;
      end(): undefined;
      label: string;
      pushDebugGroup(groupLabel: string): undefined;
      popDebugGroup(): undefined;
      insertDebugMarker(markerLabel: string): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsets?: Iterable<GPUBufferDynamicOffset>,
      ): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsetsData: Uint32Array,
        dynamicOffsetsDataStart: GPUSize64,
        dynamicOffsetsDataLength: GPUSize32,
      ): undefined;
      setImmediates(
        rangeOffset: GPUSize32,
        data: Bun.BufferSource,
        dataOffset?: GPUSize64,
        dataSize?: GPUSize64,
      ): undefined;
    }
    interface GPUTexelCopyBufferInfo extends GPUTexelCopyBufferLayout {
      buffer: GPUBuffer;
    }
    interface GPUCommandBufferDescriptor extends GPUObjectDescriptorBase {}
    interface GPURenderBundleEncoderDescriptor extends GPURenderPassLayout {
      depthReadOnly?: boolean | undefined;
      stencilReadOnly?: boolean | undefined;
    }
    interface GPURenderPassLayout extends GPUObjectDescriptorBase {
      colorFormats: Iterable<GPUTextureFormat | null>;
      depthStencilFormat?: GPUTextureFormat | undefined;
      sampleCount?: GPUSize32 | undefined;
    }
    interface GPURenderBundleEncoder {
      finish(descriptor?: GPURenderBundleDescriptor): GPURenderBundle;
      label: string;
      pushDebugGroup(groupLabel: string): undefined;
      popDebugGroup(): undefined;
      insertDebugMarker(markerLabel: string): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsets?: Iterable<GPUBufferDynamicOffset>,
      ): undefined;
      setBindGroup(
        index: GPUIndex32,
        bindGroup: GPUBindGroup | null,
        dynamicOffsetsData: Uint32Array,
        dynamicOffsetsDataStart: GPUSize64,
        dynamicOffsetsDataLength: GPUSize32,
      ): undefined;
      setImmediates(
        rangeOffset: GPUSize32,
        data: Bun.BufferSource,
        dataOffset?: GPUSize64,
        dataSize?: GPUSize64,
      ): undefined;
      setPipeline(pipeline: GPURenderPipeline): undefined;
      setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: GPUSize64, size?: GPUSize64): undefined;
      setVertexBuffer(slot: GPUIndex32, buffer: GPUBuffer | null, offset?: GPUSize64, size?: GPUSize64): undefined;
      draw(
        vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32,
      ): undefined;
      drawIndexed(
        indexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstIndex?: GPUSize32,
        baseVertex?: GPUSignedOffset32,
        firstInstance?: GPUSize32,
      ): undefined;
      drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: GPUSize64): undefined;
      drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: GPUSize64): undefined;
    }
    interface GPURenderBundleDescriptor extends GPUObjectDescriptorBase {}
    interface GPUQuerySetDescriptor extends GPUObjectDescriptorBase {
      type: GPUQueryType;
      count: GPUSize32;
    }
    interface GPUDeviceLostInfo {
      readonly reason: GPUDeviceLostReason;
      readonly message: string;
    }
    type GPUDeviceLostReason = "unknown" | "destroyed";
    type GPUErrorFilter = "validation" | "out-of-memory" | "internal";
    interface GPUError {
      readonly message: string;
    }
    interface GPUBufferUsage {
      readonly MAP_READ: number;
      readonly MAP_WRITE: number;
      readonly COPY_SRC: number;
      readonly COPY_DST: number;
      readonly INDEX: number;
      readonly VERTEX: number;
      readonly UNIFORM: number;
      readonly STORAGE: number;
      readonly INDIRECT: number;
      readonly QUERY_RESOLVE: number;
    }
    interface GPUMapMode {
      readonly READ: number;
      readonly WRITE: number;
    }
    interface GPUTextureUsage {
      readonly COPY_SRC: number;
      readonly COPY_DST: number;
      readonly TEXTURE_BINDING: number;
      readonly STORAGE_BINDING: number;
      readonly RENDER_ATTACHMENT: number;
      readonly TRANSIENT_ATTACHMENT: number;
    }
    interface GPUExternalTexture {
      label: string;
    }
    interface GPUShaderStage {
      readonly VERTEX: number;
      readonly FRAGMENT: number;
      readonly COMPUTE: number;
    }
    interface GPUPipelineError extends DOMException {
      readonly reason: GPUPipelineErrorReason;
    }
    type GPUPipelineErrorReason = "validation" | "internal";
    interface GPUPipelineErrorInit {
      reason: GPUPipelineErrorReason;
    }
    interface GPUColorWrite {
      readonly RED: number;
      readonly GREEN: number;
      readonly BLUE: number;
      readonly ALPHA: number;
      readonly ALL: number;
    }
    interface GPUValidationError extends GPUError {}
    interface GPUOutOfMemoryError extends GPUError {}
    interface GPUInternalError extends GPUError {}
    interface GPUUncapturedErrorEvent extends Event {
      readonly error: GPUError;
    }
    interface GPUUncapturedErrorEventInit extends Bun.EventInit {
      error: GPUError;
    }
    interface NavigatorGPU {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Navigator/gpu) */
      readonly gpu: GPU;
    }
  }
}

interface GPUSupportedLimits extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUSupportedLimits> {}
declare var GPUSupportedLimits: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUSupportedLimits",
  { prototype: GPUSupportedLimits; new (): never }
>;
declare var GPUSupportedFeatures: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUSupportedFeatures",
  { prototype: Bun.WebGPU.GPUSupportedFeatures; new (): never }
>;
declare var WGSLLanguageFeatures: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "WGSLLanguageFeatures",
  { prototype: Bun.WebGPU.WGSLLanguageFeatures; new (): never }
>;
interface GPUAdapterInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUAdapterInfo> {}
declare var GPUAdapterInfo: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUAdapterInfo",
  { prototype: GPUAdapterInfo; new (): never }
>;
interface GPURequestAdapterOptions extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURequestAdapterOptions> {}
interface GPUObjectDescriptorBase extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUObjectDescriptorBase> {}
interface GPUDeviceDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUDeviceDescriptor> {}
interface GPUCommandBuffer extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUCommandBuffer> {}
declare var GPUCommandBuffer: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUCommandBuffer",
  { prototype: GPUCommandBuffer; new (): never }
>;
interface GPUBuffer extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBuffer> {}
declare var GPUBuffer: Bun.__internal.UseLibDomWebGPUIfAvailable<"GPUBuffer", { prototype: GPUBuffer; new (): never }>;
interface GPUTextureViewDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTextureViewDescriptor> {}
interface GPUTextureView extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTextureView> {}
declare var GPUTextureView: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUTextureView",
  { prototype: GPUTextureView; new (): never }
>;
interface GPUTexture extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTexture> {}
declare var GPUTexture: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUTexture",
  { prototype: GPUTexture; new (): never }
>;
interface GPUOrigin3DDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUOrigin3DDict> {}
interface GPUTexelCopyTextureInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTexelCopyTextureInfo> {}
interface GPUTexelCopyBufferLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTexelCopyBufferLayout> {}
interface GPUExtent3DDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUExtent3DDict> {}
interface GPUQueue extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUQueue> {}
declare var GPUQueue: Bun.__internal.UseLibDomWebGPUIfAvailable<"GPUQueue", { prototype: GPUQueue; new (): never }>;
interface GPUBufferDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBufferDescriptor> {}
interface GPUTextureDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTextureDescriptor> {}
interface GPUSamplerDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUSamplerDescriptor> {}
interface GPUSampler extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUSampler> {}
declare var GPUSampler: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUSampler",
  { prototype: GPUSampler; new (): never }
>;
interface GPUBufferBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBufferBindingLayout> {}
interface GPUSamplerBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUSamplerBindingLayout> {}
interface GPUTextureBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTextureBindingLayout> {}
interface GPUStorageTextureBindingLayout extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPUStorageTextureBindingLayout> {}
interface GPUExternalTextureBindingLayout extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPUExternalTextureBindingLayout> {}
interface GPUBindGroupLayoutEntry extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroupLayoutEntry> {}
interface GPUBindGroupLayoutDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroupLayoutDescriptor> {}
interface GPUBindGroupLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroupLayout> {}
declare var GPUBindGroupLayout: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUBindGroupLayout",
  { prototype: GPUBindGroupLayout; new (): never }
>;
interface GPUPipelineLayoutDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPipelineLayoutDescriptor> {}
interface GPUPipelineLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPipelineLayout> {}
declare var GPUPipelineLayout: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUPipelineLayout",
  { prototype: GPUPipelineLayout; new (): never }
>;
interface GPUBufferBinding extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBufferBinding> {}
interface GPUBindGroupEntry extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroupEntry> {}
interface GPUBindGroupDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroupDescriptor> {}
interface GPUBindGroup extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBindGroup> {}
declare var GPUBindGroup: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUBindGroup",
  { prototype: GPUBindGroup; new (): never }
>;
interface GPUShaderModuleCompilationHint extends Bun.WebGPU.GPUShaderModuleCompilationHint {}
interface GPUShaderModuleDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUShaderModuleDescriptor> {}
interface GPUCompilationMessage extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUCompilationMessage> {}
declare var GPUCompilationMessage: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUCompilationMessage",
  { prototype: GPUCompilationMessage; new (): never }
>;
interface GPUCompilationInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUCompilationInfo> {}
declare var GPUCompilationInfo: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUCompilationInfo",
  { prototype: GPUCompilationInfo; new (): never }
>;
interface GPUShaderModule extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUShaderModule> {}
declare var GPUShaderModule: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUShaderModule",
  { prototype: GPUShaderModule; new (): never }
>;
interface GPUPipelineDescriptorBase extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPipelineDescriptorBase> {}
interface GPUProgrammableStage extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUProgrammableStage> {}
interface GPUComputePipelineDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPUComputePipelineDescriptor> {}
interface GPUComputePipeline extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUComputePipeline> {}
declare var GPUComputePipeline: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUComputePipeline",
  { prototype: GPUComputePipeline; new (): never }
>;
interface GPUVertexAttribute extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUVertexAttribute> {}
interface GPUVertexBufferLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUVertexBufferLayout> {}
interface GPUVertexState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUVertexState> {}
interface GPUPrimitiveState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPrimitiveState> {}
interface GPUStencilFaceState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUStencilFaceState> {}
interface GPUDepthStencilState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUDepthStencilState> {}
interface GPUMultisampleState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUMultisampleState> {}
interface GPUBlendComponent extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBlendComponent> {}
interface GPUBlendState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUBlendState> {}
interface GPUColorTargetState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUColorTargetState> {}
interface GPUFragmentState extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUFragmentState> {}
interface GPURenderPipelineDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPipelineDescriptor> {}
interface GPURenderPipeline extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPipeline> {}
declare var GPURenderPipeline: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPURenderPipeline",
  { prototype: GPURenderPipeline; new (): never }
>;
interface GPUColorDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUColorDict> {}
interface GPURenderPassColorAttachment extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassColorAttachment> {}
interface GPURenderPassDepthStencilAttachment extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassDepthStencilAttachment> {}
interface GPUQuerySet extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUQuerySet> {}
declare var GPUQuerySet: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUQuerySet",
  { prototype: GPUQuerySet; new (): never }
>;
interface GPURenderPassTimestampWrites extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassTimestampWrites> {}
interface GPURenderPassDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassDescriptor> {}
interface GPURenderBundle extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderBundle> {}
declare var GPURenderBundle: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPURenderBundle",
  { prototype: GPURenderBundle; new (): never }
>;
interface GPURenderPassEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassEncoder> {}
declare var GPURenderPassEncoder: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPURenderPassEncoder",
  { prototype: GPURenderPassEncoder; new (): never }
>;
interface GPUComputePassTimestampWrites extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPUComputePassTimestampWrites> {}
interface GPUComputePassDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUComputePassDescriptor> {}
interface GPUComputePassEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUComputePassEncoder> {}
declare var GPUComputePassEncoder: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUComputePassEncoder",
  { prototype: GPUComputePassEncoder; new (): never }
>;
interface GPUTexelCopyBufferInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUTexelCopyBufferInfo> {}
interface GPUCommandEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUCommandEncoder> {}
declare var GPUCommandEncoder: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUCommandEncoder",
  { prototype: GPUCommandEncoder; new (): never }
>;
interface GPURenderPassLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderPassLayout> {}
interface GPURenderBundleEncoderDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.WebGPU.GPURenderBundleEncoderDescriptor> {}
interface GPURenderBundleEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPURenderBundleEncoder> {}
declare var GPURenderBundleEncoder: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPURenderBundleEncoder",
  { prototype: GPURenderBundleEncoder; new (): never }
>;
interface GPUQuerySetDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUQuerySetDescriptor> {}
interface GPUDeviceLostInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUDeviceLostInfo> {}
declare var GPUDeviceLostInfo: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUDeviceLostInfo",
  { prototype: GPUDeviceLostInfo; new (): never }
>;
interface GPUError extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUError> {}
declare var GPUError: Bun.__internal.UseLibDomWebGPUIfAvailable<"GPUError", { prototype: GPUError; new (): never }>;
interface GPUDevice extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUDevice> {}
declare var GPUDevice: Bun.__internal.UseLibDomWebGPUIfAvailable<"GPUDevice", { prototype: GPUDevice; new (): never }>;
interface GPUAdapter extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUAdapter> {}
declare var GPUAdapter: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUAdapter",
  { prototype: GPUAdapter; new (): never }
>;
interface GPU extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPU> {}
declare var GPU: Bun.__internal.UseLibDomWebGPUIfAvailable<"GPU", { prototype: GPU; new (): never }>;
interface GPUBufferUsage extends Bun.WebGPU.GPUBufferUsage {}
declare var GPUBufferUsage: GPUBufferUsage;
interface GPUMapMode extends Bun.WebGPU.GPUMapMode {}
declare var GPUMapMode: GPUMapMode;
interface GPUTextureUsage extends Bun.WebGPU.GPUTextureUsage {}
declare var GPUTextureUsage: GPUTextureUsage;
interface GPUExternalTexture extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUExternalTexture> {}
declare var GPUExternalTexture: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUExternalTexture",
  { prototype: GPUExternalTexture; new (): never }
>;
interface GPUShaderStage extends Bun.WebGPU.GPUShaderStage {}
declare var GPUShaderStage: GPUShaderStage;
interface GPUPipelineError extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPipelineError> {}
interface GPUPipelineErrorInit extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUPipelineErrorInit> {}
declare var GPUPipelineError: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUPipelineError",
  { prototype: GPUPipelineError; new (message: string | undefined, options: GPUPipelineErrorInit): GPUPipelineError }
>;
interface GPUColorWrite extends Bun.WebGPU.GPUColorWrite {}
declare var GPUColorWrite: GPUColorWrite;
interface GPUValidationError extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUValidationError> {}
declare var GPUValidationError: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUValidationError",
  { prototype: GPUValidationError; new (message: string): GPUValidationError }
>;
interface GPUOutOfMemoryError extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUOutOfMemoryError> {}
declare var GPUOutOfMemoryError: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUOutOfMemoryError",
  { prototype: GPUOutOfMemoryError; new (message: string): GPUOutOfMemoryError }
>;
interface GPUInternalError extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUInternalError> {}
declare var GPUInternalError: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUInternalError",
  { prototype: GPUInternalError; new (message: string): GPUInternalError }
>;
interface GPUUncapturedErrorEvent extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUUncapturedErrorEvent> {}
interface GPUUncapturedErrorEventInit extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.GPUUncapturedErrorEventInit> {}
declare var GPUUncapturedErrorEvent: Bun.__internal.UseLibDomWebGPUIfAvailable<
  "GPUUncapturedErrorEvent",
  {
    prototype: GPUUncapturedErrorEvent;
    new (type: string, gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit): GPUUncapturedErrorEvent;
  }
>;
interface NavigatorGPU extends Bun.__internal.LibEmptyOrWebGPU<Bun.WebGPU.NavigatorGPU> {}
interface Navigator extends NavigatorGPU {}
