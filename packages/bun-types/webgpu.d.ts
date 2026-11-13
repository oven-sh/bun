declare module "bun" {
  /**
   * The type aliases of [WebGPU](https://bun.com/docs/runtime/webgpu). The interfaces, such as {@link GPUDevice} and
   * {@link GPUBufferDescriptor}, are globals.
   *
   * @example
   * ```ts
   * const format: Bun.WebGPU.GPUTextureFormat = "rgba8unorm";
   * ```
   */
  namespace WebGPU {
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
    type GPUPowerPreference = "low-power" | "high-performance";
    type GPUBufferMapState = "unmapped" | "pending" | "mapped";
    type GPUTextureDimension = "1d" | "2d" | "3d";
    type GPUTextureViewDimension = "1d" | "2d" | "2d-array" | "cube" | "cube-array" | "3d";
    type GPUTextureAspect = "all" | "stencil-only" | "depth-only";
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
    type GPUAddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";
    type GPUFilterMode = "nearest" | "linear";
    type GPUMipmapFilterMode = "nearest" | "linear";
    type GPUCompareFunction =
      "never" | "less" | "equal" | "less-equal" | "greater" | "not-equal" | "greater-equal" | "always";
    type GPUBufferBindingType = "uniform" | "storage" | "read-only-storage";
    type GPUSamplerBindingType = "filtering" | "non-filtering" | "comparison";
    type GPUTextureSampleType = "float" | "unfilterable-float" | "depth" | "sint" | "uint";
    type GPUStorageTextureAccess = "write-only" | "read-only" | "read-write";
    type GPUCompilationMessageType = "error" | "warning" | "info";
    type GPUPipelineErrorReason = "validation" | "internal";
    type GPUAutoLayoutMode = "auto";
    type GPUPrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";
    type GPUFrontFace = "ccw" | "cw";
    type GPUCullMode = "none" | "front" | "back";
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
    type GPUBlendOperation = "add" | "subtract" | "reverse-subtract" | "min" | "max";
    type GPUStencilOperation =
      | "keep"
      | "zero"
      | "replace"
      | "invert"
      | "increment-clamp"
      | "decrement-clamp"
      | "increment-wrap"
      | "decrement-wrap";
    type GPUIndexFormat = "uint16" | "uint32";
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
    type GPUVertexStepMode = "vertex" | "instance";
    type GPULoadOp = "load" | "clear";
    type GPUStoreOp = "store" | "discard";
    type GPUQueryType = "occlusion" | "timestamp";
    type GPUDeviceLostReason = "unknown" | "destroyed";
    type GPUErrorFilter = "validation" | "out-of-memory" | "internal";

    type GPUBindingResource = GPUSampler | GPUTexture | GPUTextureView | GPUBuffer | GPUBufferBinding;
    /** `[r, g, b, a]` or `{ r, g, b, a }` */
    type GPUColor = Iterable<number> | GPUColorDict;
    /** `[width, height?, depthOrArrayLayers?]` or `{ width, height?, depthOrArrayLayers? }` */
    type GPUExtent3D = Iterable<number> | GPUExtent3DDict;
    /** `[x?, y?, z?]` or `{ x?, y?, z? }` */
    type GPUOrigin3D = Iterable<number> | GPUOrigin3DDict;

    type GPUCommandBufferDescriptor = GPUObjectDescriptorBase;
    type GPUCommandEncoderDescriptor = GPUObjectDescriptorBase;
    type GPURenderBundleDescriptor = GPUObjectDescriptorBase;
    type GPUQueueDescriptor = GPUObjectDescriptorBase;

    /**
     * The names of the features that an adapter supports, or that a device was created with.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUSupportedFeatures)
     */
    interface GPUSupportedFeatures extends __internal.ReadonlySetlike<string> {}

    /**
     * The names of the WGSL language extensions that shaders can use.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WGSLLanguageFeatures)
     */
    interface WGSLLanguageFeatures extends __internal.ReadonlySetlike<string> {}
  }

  namespace __internal {
    /**
     * What else declares WebGPU: lib.dom.d.ts and lib.webworker.d.ts do since TypeScript 6.0, and so does
     * `@webgpu/types`. All of them have `GPUCanvasContext`, which Bun does not.
     */
    type OtherWebGPUDeclarations = typeof globalThis extends { GPUCanvasContext: new () => infer Instance }
      ? [Instance] extends [never]
        ? "@webgpu/types"
        : "lib"
      : "none";

    type LibEmptyOrWebGPU<Otherwise> = OtherWebGPUDeclarations extends "none" ? Otherwise : {};

    /** `Otherwise` is the same type that `@webgpu/types` declares, which may be loaded before or after this file. */
    type UseLibWebGPUIfAvailable<Name extends PropertyKey, Otherwise> = OtherWebGPUDeclarations extends "lib"
      ? typeof globalThis extends { [K in Name]: infer T }
        ? T
        : Otherwise
      : Otherwise;

    type ReadonlySetlike<T> = Pick<
      ReadonlySet<T>,
      "size" | "has" | "keys" | "values" | "entries" | "forEach" | typeof Symbol.iterator
    >;

    interface BunGPUObjectDescriptorBase {
      /**
       * Names the object in error messages and in GPU debuggers.
       *
       * @default ""
       */
      label?: string | undefined;
    }

    interface BunGPURequestAdapterOptions {
      /**
       * `"core"` or `"compatibility"`. With any other value there is no adapter.
       *
       * @default "core"
       */
      featureLevel?: string | undefined;
      powerPreference?: WebGPU.GPUPowerPreference | undefined;
      /**
       * Only accept an adapter that runs on the CPU.
       *
       * @default false
       */
      forceFallbackAdapter?: boolean | undefined;
      /**
       * Has no effect in Bun.
       *
       * @default false
       */
      xrCompatible?: boolean | undefined;
    }

    interface BunGPUDeviceDescriptor extends GPUObjectDescriptorBase {
      requiredFeatures?: Iterable<WebGPU.GPUFeatureName> | undefined;
      /** The names are those of {@link GPUSupportedLimits}. A limit that is left out has the default value of the specification. */
      requiredLimits?: Record<string, number | undefined> | undefined;
      defaultQueue?: WebGPU.GPUQueueDescriptor | undefined;
    }

    interface BunGPUBufferDescriptor extends GPUObjectDescriptorBase {
      size: number;
      /** {@link GPUBufferUsage} flags */
      usage: number;
      /** @default false */
      mappedAtCreation?: boolean | undefined;
    }

    interface BunGPUTextureDescriptor extends GPUObjectDescriptorBase {
      size: WebGPU.GPUExtent3D;
      /** @default 1 */
      mipLevelCount?: number | undefined;
      /** @default 1 */
      sampleCount?: number | undefined;
      /** @default "2d" */
      dimension?: WebGPU.GPUTextureDimension | undefined;
      format: WebGPU.GPUTextureFormat;
      /** {@link GPUTextureUsage} flags */
      usage: number;
      viewFormats?: Iterable<WebGPU.GPUTextureFormat> | undefined;
      textureBindingViewDimension?: WebGPU.GPUTextureViewDimension | undefined;
    }

    interface BunGPUTextureViewDescriptor extends GPUObjectDescriptorBase {
      format?: WebGPU.GPUTextureFormat | undefined;
      dimension?: WebGPU.GPUTextureViewDimension | undefined;
      /**
       * {@link GPUTextureUsage} flags. 0 stands for those of the texture.
       *
       * @default 0
       */
      usage?: number | undefined;
      /** @default "all" */
      aspect?: WebGPU.GPUTextureAspect | undefined;
      /** @default 0 */
      baseMipLevel?: number | undefined;
      mipLevelCount?: number | undefined;
      /** @default 0 */
      baseArrayLayer?: number | undefined;
      arrayLayerCount?: number | undefined;
      /**
       * Four of the characters `rgba01`.
       *
       * @default "rgba"
       */
      swizzle?: string | undefined;
    }

    interface BunGPUSamplerDescriptor extends GPUObjectDescriptorBase {
      /** @default "clamp-to-edge" */
      addressModeU?: WebGPU.GPUAddressMode | undefined;
      /** @default "clamp-to-edge" */
      addressModeV?: WebGPU.GPUAddressMode | undefined;
      /** @default "clamp-to-edge" */
      addressModeW?: WebGPU.GPUAddressMode | undefined;
      /** @default "nearest" */
      magFilter?: WebGPU.GPUFilterMode | undefined;
      /** @default "nearest" */
      minFilter?: WebGPU.GPUFilterMode | undefined;
      /** @default "nearest" */
      mipmapFilter?: WebGPU.GPUMipmapFilterMode | undefined;
      /** @default 0 */
      lodMinClamp?: number | undefined;
      /** @default 32 */
      lodMaxClamp?: number | undefined;
      compare?: WebGPU.GPUCompareFunction | undefined;
      /** @default 1 */
      maxAnisotropy?: number | undefined;
    }

    interface BunGPUBindGroupLayoutDescriptor extends GPUObjectDescriptorBase {
      entries: Iterable<GPUBindGroupLayoutEntry>;
    }

    interface BunGPUBindGroupLayoutEntry {
      binding: number;
      /** {@link GPUShaderStage} flags */
      visibility: number;
      buffer?: GPUBufferBindingLayout | undefined;
      sampler?: GPUSamplerBindingLayout | undefined;
      texture?: GPUTextureBindingLayout | undefined;
      storageTexture?: GPUStorageTextureBindingLayout | undefined;
      externalTexture?: GPUExternalTextureBindingLayout | undefined;
    }

    interface BunGPUBufferBindingLayout {
      /** @default "uniform" */
      type?: WebGPU.GPUBufferBindingType | undefined;
      /** @default false */
      hasDynamicOffset?: boolean | undefined;
      /** @default 0 */
      minBindingSize?: number | undefined;
    }

    interface BunGPUSamplerBindingLayout {
      /** @default "filtering" */
      type?: WebGPU.GPUSamplerBindingType | undefined;
    }

    interface BunGPUTextureBindingLayout {
      /** @default "float" */
      sampleType?: WebGPU.GPUTextureSampleType | undefined;
      /** @default "2d" */
      viewDimension?: WebGPU.GPUTextureViewDimension | undefined;
      /** @default false */
      multisampled?: boolean | undefined;
    }

    interface BunGPUStorageTextureBindingLayout {
      /** @default "write-only" */
      access?: WebGPU.GPUStorageTextureAccess | undefined;
      format: WebGPU.GPUTextureFormat;
      /** @default "2d" */
      viewDimension?: WebGPU.GPUTextureViewDimension | undefined;
    }

    interface BunGPUExternalTextureBindingLayout {}

    interface BunGPUBindGroupDescriptor extends GPUObjectDescriptorBase {
      layout: GPUBindGroupLayout;
      entries: Iterable<GPUBindGroupEntry>;
    }

    interface BunGPUBindGroupEntry {
      binding: number;
      resource: WebGPU.GPUBindingResource;
    }

    interface BunGPUBufferBinding {
      buffer: GPUBuffer;
      /** @default 0 */
      offset?: number | undefined;
      size?: number | undefined;
    }

    interface BunGPUPipelineLayoutDescriptor extends GPUObjectDescriptorBase {
      bindGroupLayouts: Iterable<GPUBindGroupLayout | null | undefined>;
      /** @default 0 */
      immediateSize?: number | undefined;
    }

    interface BunGPUShaderModuleDescriptor extends GPUObjectDescriptorBase {
      /** [WGSL](https://www.w3.org/TR/WGSL/) source code */
      code: string;
      /** Has no effect in Bun. */
      compilationHints?: Iterable<GPUShaderModuleCompilationHint> | undefined;
    }

    interface BunGPUShaderModuleCompilationHint {
      entryPoint: string;
      layout?: GPUPipelineLayout | WebGPU.GPUAutoLayoutMode | undefined;
    }

    interface BunGPUPipelineErrorInit {
      reason: WebGPU.GPUPipelineErrorReason;
    }

    interface BunGPUPipelineDescriptorBase extends GPUObjectDescriptorBase {
      layout: GPUPipelineLayout | WebGPU.GPUAutoLayoutMode;
    }

    interface BunGPUProgrammableStage {
      module: GPUShaderModule;
      entryPoint?: string | undefined;
      constants?: Record<string, number> | undefined;
    }

    interface BunGPUComputePipelineDescriptor extends GPUPipelineDescriptorBase {
      compute: GPUProgrammableStage;
    }

    interface BunGPURenderPipelineDescriptor extends GPUPipelineDescriptorBase {
      vertex: GPUVertexState;
      primitive?: GPUPrimitiveState | undefined;
      depthStencil?: GPUDepthStencilState | undefined;
      multisample?: GPUMultisampleState | undefined;
      fragment?: GPUFragmentState | undefined;
    }

    interface BunGPUPrimitiveState {
      /** @default "triangle-list" */
      topology?: WebGPU.GPUPrimitiveTopology | undefined;
      stripIndexFormat?: WebGPU.GPUIndexFormat | undefined;
      /** @default "ccw" */
      frontFace?: WebGPU.GPUFrontFace | undefined;
      /** @default "none" */
      cullMode?: WebGPU.GPUCullMode | undefined;
      /** @default false */
      unclippedDepth?: boolean | undefined;
    }

    interface BunGPUMultisampleState {
      /** @default 1 */
      count?: number | undefined;
      /** @default 0xFFFFFFFF */
      mask?: number | undefined;
      /** @default false */
      alphaToCoverageEnabled?: boolean | undefined;
    }

    interface BunGPUFragmentState extends GPUProgrammableStage {
      targets: Iterable<GPUColorTargetState | null | undefined>;
    }

    interface BunGPUColorTargetState {
      format: WebGPU.GPUTextureFormat;
      blend?: GPUBlendState | undefined;
      /**
       * {@link GPUColorWrite} flags
       *
       * @default 0xF
       */
      writeMask?: number | undefined;
    }

    interface BunGPUBlendState {
      color: GPUBlendComponent;
      alpha: GPUBlendComponent;
    }

    interface BunGPUBlendComponent {
      /** @default "add" */
      operation?: WebGPU.GPUBlendOperation | undefined;
      /** @default "one" */
      srcFactor?: WebGPU.GPUBlendFactor | undefined;
      /** @default "zero" */
      dstFactor?: WebGPU.GPUBlendFactor | undefined;
    }

    interface BunGPUDepthStencilState {
      format: WebGPU.GPUTextureFormat;
      depthWriteEnabled?: boolean | undefined;
      depthCompare?: WebGPU.GPUCompareFunction | undefined;
      stencilFront?: GPUStencilFaceState | undefined;
      stencilBack?: GPUStencilFaceState | undefined;
      /** @default 0xFFFFFFFF */
      stencilReadMask?: number | undefined;
      /** @default 0xFFFFFFFF */
      stencilWriteMask?: number | undefined;
      /** @default 0 */
      depthBias?: number | undefined;
      /** @default 0 */
      depthBiasSlopeScale?: number | undefined;
      /** @default 0 */
      depthBiasClamp?: number | undefined;
    }

    interface BunGPUStencilFaceState {
      /** @default "always" */
      compare?: WebGPU.GPUCompareFunction | undefined;
      /** @default "keep" */
      failOp?: WebGPU.GPUStencilOperation | undefined;
      /** @default "keep" */
      depthFailOp?: WebGPU.GPUStencilOperation | undefined;
      /** @default "keep" */
      passOp?: WebGPU.GPUStencilOperation | undefined;
    }

    interface BunGPUVertexState extends GPUProgrammableStage {
      buffers?: Iterable<GPUVertexBufferLayout | null | undefined> | undefined;
    }

    interface BunGPUVertexBufferLayout {
      arrayStride: number;
      /** @default "vertex" */
      stepMode?: WebGPU.GPUVertexStepMode | undefined;
      attributes: Iterable<GPUVertexAttribute>;
    }

    interface BunGPUVertexAttribute {
      format: WebGPU.GPUVertexFormat;
      offset: number;
      shaderLocation: number;
    }

    interface BunGPUTexelCopyBufferLayout {
      /** @default 0 */
      offset?: number | undefined;
      bytesPerRow?: number | undefined;
      rowsPerImage?: number | undefined;
    }

    interface BunGPUTexelCopyBufferInfo extends GPUTexelCopyBufferLayout {
      buffer: GPUBuffer;
    }

    interface BunGPUTexelCopyTextureInfo {
      texture: GPUTexture;
      /** @default 0 */
      mipLevel?: number | undefined;
      origin?: WebGPU.GPUOrigin3D | undefined;
      /** @default "all" */
      aspect?: WebGPU.GPUTextureAspect | undefined;
    }

    interface BunGPUComputePassTimestampWrites {
      querySet: GPUQuerySet;
      beginningOfPassWriteIndex?: number | undefined;
      endOfPassWriteIndex?: number | undefined;
    }

    interface BunGPUComputePassDescriptor extends GPUObjectDescriptorBase {
      timestampWrites?: GPUComputePassTimestampWrites | undefined;
    }

    interface BunGPURenderPassTimestampWrites {
      querySet: GPUQuerySet;
      beginningOfPassWriteIndex?: number | undefined;
      endOfPassWriteIndex?: number | undefined;
    }

    interface BunGPURenderPassDescriptor extends GPUObjectDescriptorBase {
      colorAttachments: Iterable<GPURenderPassColorAttachment | null | undefined>;
      depthStencilAttachment?: GPURenderPassDepthStencilAttachment | undefined;
      occlusionQuerySet?: GPUQuerySet | undefined;
      timestampWrites?: GPURenderPassTimestampWrites | undefined;
      /** @default 50000000 */
      maxDrawCount?: number | undefined;
    }

    interface BunGPURenderPassColorAttachment {
      view: GPUTexture | GPUTextureView;
      depthSlice?: number | undefined;
      resolveTarget?: GPUTexture | GPUTextureView | undefined;
      clearValue?: WebGPU.GPUColor | undefined;
      loadOp: WebGPU.GPULoadOp;
      storeOp: WebGPU.GPUStoreOp;
    }

    interface BunGPURenderPassDepthStencilAttachment {
      view: GPUTexture | GPUTextureView;
      depthClearValue?: number | undefined;
      depthLoadOp?: WebGPU.GPULoadOp | undefined;
      depthStoreOp?: WebGPU.GPUStoreOp | undefined;
      /** @default false */
      depthReadOnly?: boolean | undefined;
      /** @default 0 */
      stencilClearValue?: number | undefined;
      stencilLoadOp?: WebGPU.GPULoadOp | undefined;
      stencilStoreOp?: WebGPU.GPUStoreOp | undefined;
      /** @default false */
      stencilReadOnly?: boolean | undefined;
    }

    interface BunGPURenderPassLayout extends GPUObjectDescriptorBase {
      colorFormats: Iterable<WebGPU.GPUTextureFormat | null | undefined>;
      depthStencilFormat?: WebGPU.GPUTextureFormat | undefined;
      /** @default 1 */
      sampleCount?: number | undefined;
    }

    interface BunGPURenderBundleEncoderDescriptor extends GPURenderPassLayout {
      /** @default false */
      depthReadOnly?: boolean | undefined;
      /** @default false */
      stencilReadOnly?: boolean | undefined;
    }

    interface BunGPUQuerySetDescriptor extends GPUObjectDescriptorBase {
      type: WebGPU.GPUQueryType;
      count: number;
    }

    interface BunGPUUncapturedErrorEventInit extends EventInit {
      error: GPUError;
    }

    interface BunGPUColorDict {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    interface BunGPUOrigin3DDict {
      /** @default 0 */
      x?: number | undefined;
      /** @default 0 */
      y?: number | undefined;
      /** @default 0 */
      z?: number | undefined;
    }

    interface BunGPUExtent3DDict {
      width: number;
      /** @default 1 */
      height?: number | undefined;
      /** @default 1 */
      depthOrArrayLayers?: number | undefined;
    }

    interface BunGPUObjectBase {
      /** Names the object in error messages and in GPU debuggers. */
      label: string;
    }

    interface BunGPUSupportedLimits {
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

    interface BunGPUAdapterInfo {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/vendor) */
      readonly vendor: string;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/architecture) */
      readonly architecture: string;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/device) */
      readonly device: string;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/description) */
      readonly description: string;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/subgroupMinSize) */
      readonly subgroupMinSize: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/subgroupMaxSize) */
      readonly subgroupMaxSize: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo/isFallbackAdapter) */
      readonly isFallbackAdapter: boolean;
    }

    interface BunGPU {
      /**
       * Finds a GPU. Resolves to `null` if the machine has no driver that WebGPU can use.
       *
       * Bun uses Metal on macOS, Direct3D 12 on Windows and Vulkan everywhere else. If there is no GPU, a driver that
       * runs on the CPU is used if the system has one, and `adapter.info.isFallbackAdapter` is `true`.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPU/requestAdapter)
       */
      requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
      /**
       * Bun has no canvas. This returns what a browser on the same system does.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPU/getPreferredCanvasFormat)
       */
      getPreferredCanvasFormat(): WebGPU.GPUTextureFormat;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPU/wgslLanguageFeatures) */
      readonly wgslLanguageFeatures: WebGPU.WGSLLanguageFeatures;
    }

    interface BunGPUAdapter {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapter/features) */
      readonly features: WebGPU.GPUSupportedFeatures;
      /**
       * The best limits that `requestDevice()` can ask for. Bun reports what the driver does, and does not round
       * the values down to tiers as browsers do.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapter/limits)
       */
      readonly limits: GPUSupportedLimits;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapter/info) */
      readonly info: GPUAdapterInfo;
      /**
       * Opens the GPU. An adapter makes one device: request another adapter for the next one.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapter/requestDevice)
       */
      requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    }

    interface BunGPUDevice extends EventTarget, BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/features) */
      readonly features: WebGPU.GPUSupportedFeatures;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/limits) */
      readonly limits: GPUSupportedLimits;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/adapterInfo) */
      readonly adapterInfo: GPUAdapterInfo;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/queue) */
      readonly queue: GPUQueue;
      /**
       * Unmaps every buffer, waits for the GPU and frees everything that the device made. `lost` then resolves.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/destroy)
       */
      destroy(): undefined;
      /**
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createBuffer)
       *
       * @throws {RangeError} if `mappedAtCreation` is set and `size` is not a multiple of 4 or cannot be allocated
       */
      createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createTexture) */
      createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createSampler) */
      createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createBindGroupLayout) */
      createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createPipelineLayout) */
      createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createBindGroup) */
      createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createShaderModule) */
      createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createComputePipeline) */
      createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createRenderPipeline) */
      createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
      /**
       * Compiles the pipeline on another thread. Rejects with a {@link GPUPipelineError}.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createComputePipelineAsync)
       */
      createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
      /**
       * Compiles the pipeline on another thread. Rejects with a {@link GPUPipelineError}.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createRenderPipelineAsync)
       */
      createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createCommandEncoder) */
      createCommandEncoder(descriptor?: WebGPU.GPUCommandEncoderDescriptor): GPUCommandEncoder;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createRenderBundleEncoder) */
      createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/createQuerySet) */
      createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
      /**
       * Resolves when the device is destroyed or stops working. It does not keep the process alive.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/lost)
       */
      readonly lost: Promise<GPUDeviceLostInfo>;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/pushErrorScope) */
      pushErrorScope(filter: WebGPU.GPUErrorFilter): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/popErrorScope) */
      popErrorScope(): Promise<GPUError | null>;
      /**
       * Called for an error that no error scope captured. Bun prints the error unless a listener calls
       * `event.preventDefault()`.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice/uncapturederror_event)
       */
      onuncapturederror: ((this: GPUDevice, event: GPUUncapturedErrorEvent) => any) | null;
      addEventListener(
        type: "uncapturederror",
        listener: (this: GPUDevice, event: GPUUncapturedErrorEvent) => any,
        options?: boolean | AddEventListenerOptions,
      ): void;
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void;
      removeEventListener(
        type: "uncapturederror",
        listener: (this: GPUDevice, event: GPUUncapturedErrorEvent) => any,
        options?: boolean | EventListenerOptions,
      ): void;
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void;
    }

    interface BunGPUBuffer extends BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/size) */
      readonly size: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/usage) */
      readonly usage: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/mapState) */
      readonly mapState: WebGPU.GPUBufferMapState;
      /**
       * Resolves once the GPU has finished with the buffer and `getMappedRange()` can be called.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/mapAsync)
       *
       * @param mode {@link GPUMapMode}
       */
      mapAsync(mode: number, offset?: number, size?: number): Promise<undefined>;
      /**
       * The contents of a part of the mapped range. `unmap()` detaches the `ArrayBuffer`, so copy what has to outlive it.
       * It cannot be transferred.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/getMappedRange)
       */
      getMappedRange(offset?: number, size?: number): ArrayBuffer;
      /**
       * Hands the buffer back to the GPU.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/unmap)
       */
      unmap(): undefined;
      /**
       * Frees the memory without waiting for the garbage collector.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer/destroy)
       */
      destroy(): undefined;
    }

    interface BunGPUTexture extends BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/createView) */
      createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
      /**
       * Frees the memory without waiting for the garbage collector.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/destroy)
       */
      destroy(): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/width) */
      readonly width: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/height) */
      readonly height: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/depthOrArrayLayers) */
      readonly depthOrArrayLayers: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/mipLevelCount) */
      readonly mipLevelCount: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/sampleCount) */
      readonly sampleCount: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/dimension) */
      readonly dimension: WebGPU.GPUTextureDimension;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/format) */
      readonly format: WebGPU.GPUTextureFormat;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/usage) */
      readonly usage: number;
      /**
       * Only set on a device without the `"core-features-and-limits"` feature.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture/textureBindingViewDimension)
       */
      readonly textureBindingViewDimension: WebGPU.GPUTextureViewDimension | undefined;
    }

    interface BunGPUTextureView extends BunGPUObjectBase {}

    interface BunGPUExternalTexture extends BunGPUObjectBase {}

    interface BunGPUSampler extends BunGPUObjectBase {}

    interface BunGPUBindGroupLayout extends BunGPUObjectBase {}

    interface BunGPUBindGroup extends BunGPUObjectBase {}

    interface BunGPUPipelineLayout extends BunGPUObjectBase {}

    interface BunGPUShaderModule extends BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUShaderModule/getCompilationInfo) */
      getCompilationInfo(): Promise<GPUCompilationInfo>;
    }

    interface BunGPUCompilationMessage {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/message) */
      readonly message: string;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/type) */
      readonly type: WebGPU.GPUCompilationMessageType;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/lineNum) */
      readonly lineNum: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/linePos) */
      readonly linePos: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/offset) */
      readonly offset: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage/length) */
      readonly length: number;
    }

    interface BunGPUCompilationInfo {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationInfo/messages) */
      readonly messages: ReadonlyArray<GPUCompilationMessage>;
    }

    interface BunGPUPipelineError extends DOMException {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUPipelineError/reason) */
      readonly reason: WebGPU.GPUPipelineErrorReason;
    }

    interface BunGPUPipelineBase {
      getBindGroupLayout(index: number): GPUBindGroupLayout;
    }

    interface BunGPUComputePipeline extends BunGPUObjectBase, BunGPUPipelineBase {}

    interface BunGPURenderPipeline extends BunGPUObjectBase, BunGPUPipelineBase {}

    interface BunGPUCommandBuffer extends BunGPUObjectBase {}

    interface BunGPUCommandEncoder extends BunGPUObjectBase, BunGPUDebugCommandsMixin {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/beginRenderPass) */
      beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/beginComputePass) */
      beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
      /**
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/copyBufferToBuffer)
       *
       * @param size defaults to the size of `source`
       */
      copyBufferToBuffer(source: GPUBuffer, destination: GPUBuffer, size?: number): undefined;
      /**
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/copyBufferToBuffer)
       *
       * @param size defaults to the rest of `source`
       */
      copyBufferToBuffer(
        source: GPUBuffer,
        sourceOffset: number,
        destination: GPUBuffer,
        destinationOffset: number,
        size?: number,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/copyBufferToTexture) */
      copyBufferToTexture(
        source: GPUTexelCopyBufferInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: WebGPU.GPUExtent3D,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/copyTextureToBuffer) */
      copyTextureToBuffer(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        copySize: WebGPU.GPUExtent3D,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/copyTextureToTexture) */
      copyTextureToTexture(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: WebGPU.GPUExtent3D,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/clearBuffer) */
      clearBuffer(buffer: GPUBuffer, offset?: number, size?: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/resolveQuerySet) */
      resolveQuerySet(
        querySet: GPUQuerySet,
        firstQuery: number,
        queryCount: number,
        destination: GPUBuffer,
        destinationOffset: number,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder/finish) */
      finish(descriptor?: WebGPU.GPUCommandBufferDescriptor): GPUCommandBuffer;
    }

    interface BunGPUBindingCommandsMixin {
      setBindGroup(
        index: number,
        bindGroup: GPUBindGroup | null | undefined,
        dynamicOffsets?: Iterable<number>,
      ): undefined;
      setBindGroup(
        index: number,
        bindGroup: GPUBindGroup | null | undefined,
        dynamicOffsetsData: Uint32Array<ArrayBufferLike>,
        dynamicOffsetsDataStart: number,
        dynamicOffsetsDataLength: number,
      ): undefined;
      /**
       * @param dataOffset in elements if `data` is a typed array, in bytes otherwise
       * @param dataSize in the same unit
       */
      setImmediates(rangeOffset: number, data: BufferSource, dataOffset?: number, dataSize?: number): undefined;
    }

    interface BunGPUDebugCommandsMixin {
      pushDebugGroup(groupLabel: string): undefined;
      popDebugGroup(): undefined;
      insertDebugMarker(markerLabel: string): undefined;
    }

    interface BunGPUComputePassEncoder extends BunGPUObjectBase, BunGPUDebugCommandsMixin, BunGPUBindingCommandsMixin {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder/setPipeline) */
      setPipeline(pipeline: GPUComputePipeline): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroups) */
      dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroupsIndirect) */
      dispatchWorkgroupsIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder/end) */
      end(): undefined;
    }

    interface BunGPURenderPassEncoder
      extends BunGPUObjectBase, BunGPUDebugCommandsMixin, BunGPUBindingCommandsMixin, BunGPURenderCommandsMixin {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/setViewport) */
      setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/setScissorRect) */
      setScissorRect(x: number, y: number, width: number, height: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/setBlendConstant) */
      setBlendConstant(color: WebGPU.GPUColor): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/setStencilReference) */
      setStencilReference(reference: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/beginOcclusionQuery) */
      beginOcclusionQuery(queryIndex: number): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/endOcclusionQuery) */
      endOcclusionQuery(): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/executeBundles) */
      executeBundles(bundles: Iterable<GPURenderBundle>): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder/end) */
      end(): undefined;
    }

    interface BunGPURenderCommandsMixin {
      setPipeline(pipeline: GPURenderPipeline): undefined;
      setIndexBuffer(buffer: GPUBuffer, indexFormat: WebGPU.GPUIndexFormat, offset?: number, size?: number): undefined;
      setVertexBuffer(slot: number, buffer: GPUBuffer | null | undefined, offset?: number, size?: number): undefined;
      draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): undefined;
      drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number,
      ): undefined;
      drawIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): undefined;
      drawIndexedIndirect(indirectBuffer: GPUBuffer, indirectOffset: number): undefined;
    }

    interface BunGPURenderBundle extends BunGPUObjectBase {}

    interface BunGPURenderBundleEncoder
      extends BunGPUObjectBase, BunGPUDebugCommandsMixin, BunGPUBindingCommandsMixin, BunGPURenderCommandsMixin {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderBundleEncoder/finish) */
      finish(descriptor?: WebGPU.GPURenderBundleDescriptor): GPURenderBundle;
    }

    interface BunGPUQueue extends BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQueue/submit) */
      submit(commandBuffers: Iterable<GPUCommandBuffer>): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQueue/onSubmittedWorkDone) */
      onSubmittedWorkDone(): Promise<undefined>;
      /**
       * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQueue/writeBuffer)
       *
       * @param dataOffset in elements if `data` is a typed array, in bytes otherwise
       * @param size in the same unit
       */
      writeBuffer(
        buffer: GPUBuffer,
        bufferOffset: number,
        data: BufferSource,
        dataOffset?: number,
        size?: number,
      ): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQueue/writeTexture) */
      writeTexture(
        destination: GPUTexelCopyTextureInfo,
        data: BufferSource,
        dataLayout: GPUTexelCopyBufferLayout,
        size: WebGPU.GPUExtent3D,
      ): undefined;
    }

    interface BunGPUQuerySet extends BunGPUObjectBase {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQuerySet/destroy) */
      destroy(): undefined;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQuerySet/type) */
      readonly type: WebGPU.GPUQueryType;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQuerySet/count) */
      readonly count: number;
    }

    interface BunGPUDeviceLostInfo {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDeviceLostInfo/reason) */
      readonly reason: WebGPU.GPUDeviceLostReason;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDeviceLostInfo/message) */
      readonly message: string;
    }

    interface BunGPUError {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUError/message) */
      readonly message: string;
    }

    interface BunGPUValidationError extends GPUError {}

    interface BunGPUOutOfMemoryError extends GPUError {}

    interface BunGPUInternalError extends GPUError {}

    interface BunGPUUncapturedErrorEvent extends Event {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUUncapturedErrorEvent/error) */
      readonly error: GPUError;
    }
  }
}

interface GPUObjectDescriptorBase extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUObjectDescriptorBase> {}
interface GPURequestAdapterOptions extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURequestAdapterOptions> {}
interface GPUDeviceDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUDeviceDescriptor> {}
interface GPUBufferDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBufferDescriptor> {}
interface GPUTextureDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTextureDescriptor> {}
interface GPUTextureViewDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUTextureViewDescriptor> {}
interface GPUSamplerDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUSamplerDescriptor> {}
interface GPUBindGroupLayoutDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroupLayoutDescriptor> {}
interface GPUBindGroupLayoutEntry extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroupLayoutEntry> {}
interface GPUBufferBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBufferBindingLayout> {}
interface GPUSamplerBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUSamplerBindingLayout> {}
interface GPUTextureBindingLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTextureBindingLayout> {}
interface GPUStorageTextureBindingLayout extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUStorageTextureBindingLayout> {}
interface GPUExternalTextureBindingLayout extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUExternalTextureBindingLayout> {}
interface GPUBindGroupDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroupDescriptor> {}
interface GPUBindGroupEntry extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroupEntry> {}
interface GPUBufferBinding extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBufferBinding> {}
interface GPUPipelineLayoutDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUPipelineLayoutDescriptor> {}
interface GPUShaderModuleDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUShaderModuleDescriptor> {}
interface GPUShaderModuleCompilationHint extends Bun.__internal.BunGPUShaderModuleCompilationHint {}
interface GPUPipelineErrorInit extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUPipelineErrorInit> {}
interface GPUPipelineDescriptorBase extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUPipelineDescriptorBase> {}
interface GPUProgrammableStage extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUProgrammableStage> {}
interface GPUComputePipelineDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUComputePipelineDescriptor> {}
interface GPURenderPipelineDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPipelineDescriptor> {}
interface GPUPrimitiveState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUPrimitiveState> {}
interface GPUMultisampleState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUMultisampleState> {}
interface GPUFragmentState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUFragmentState> {}
interface GPUColorTargetState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUColorTargetState> {}
interface GPUBlendState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBlendState> {}
interface GPUBlendComponent extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBlendComponent> {}
interface GPUDepthStencilState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUDepthStencilState> {}
interface GPUStencilFaceState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUStencilFaceState> {}
interface GPUVertexState extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUVertexState> {}
interface GPUVertexBufferLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUVertexBufferLayout> {}
interface GPUVertexAttribute extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUVertexAttribute> {}
interface GPUTexelCopyBufferLayout extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUTexelCopyBufferLayout> {}
interface GPUTexelCopyBufferInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTexelCopyBufferInfo> {}
interface GPUTexelCopyTextureInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTexelCopyTextureInfo> {}
interface GPUComputePassTimestampWrites extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUComputePassTimestampWrites> {}
interface GPUComputePassDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUComputePassDescriptor> {}
interface GPURenderPassTimestampWrites extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassTimestampWrites> {}
interface GPURenderPassDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassDescriptor> {}
interface GPURenderPassColorAttachment extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassColorAttachment> {}
interface GPURenderPassDepthStencilAttachment extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassDepthStencilAttachment> {}
interface GPURenderPassLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassLayout> {}
interface GPURenderBundleEncoderDescriptor extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPURenderBundleEncoderDescriptor> {}
interface GPUQuerySetDescriptor extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUQuerySetDescriptor> {}
interface GPUUncapturedErrorEventInit extends Bun.__internal
  .LibEmptyOrWebGPU<Bun.__internal.BunGPUUncapturedErrorEventInit> {}
interface GPUColorDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUColorDict> {}
interface GPUOrigin3DDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUOrigin3DDict> {}
interface GPUExtent3DDict extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUExtent3DDict> {}

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUSupportedLimits) */
interface GPUSupportedLimits extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUSupportedLimits> {}
declare var GPUSupportedLimits: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUSupportedLimits",
  { prototype: GPUSupportedLimits; new (): never }
>;

/**
 * Names an adapter.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapterInfo)
 */
interface GPUAdapterInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUAdapterInfo> {}
declare var GPUAdapterInfo: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUAdapterInfo",
  { prototype: GPUAdapterInfo; new (): never }
>;

/**
 * The type of `navigator.gpu`.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPU)
 */
interface GPU extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPU> {}
declare var GPU: Bun.__internal.UseLibWebGPUIfAvailable<"GPU", { prototype: GPU; new (): never }>;

/**
 * A GPU and its capabilities.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUAdapter)
 */
interface GPUAdapter extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUAdapter> {}
declare var GPUAdapter: Bun.__internal.UseLibWebGPUIfAvailable<"GPUAdapter", { prototype: GPUAdapter; new (): never }>;

/**
 * An open connection to a GPU, which creates every other object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDevice)
 */
interface GPUDevice extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUDevice> {}
declare var GPUDevice: Bun.__internal.UseLibWebGPUIfAvailable<"GPUDevice", { prototype: GPUDevice; new (): never }>;

/**
 * Memory that the GPU reads and writes.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBuffer)
 */
interface GPUBuffer extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBuffer> {}
declare var GPUBuffer: Bun.__internal.UseLibWebGPUIfAvailable<"GPUBuffer", { prototype: GPUBuffer; new (): never }>;

/**
 * An image that the GPU samples, writes or renders to.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTexture)
 */
interface GPUTexture extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTexture> {}
declare var GPUTexture: Bun.__internal.UseLibWebGPUIfAvailable<"GPUTexture", { prototype: GPUTexture; new (): never }>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUTextureView) */
interface GPUTextureView extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUTextureView> {}
declare var GPUTextureView: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUTextureView",
  { prototype: GPUTextureView; new (): never }
>;

/**
 * A video frame. Bun has no way to make one. A `texture_external` in a shader can be bound to a {@link GPUTexture} or a {@link GPUTextureView}.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUExternalTexture)
 */
interface GPUExternalTexture extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUExternalTexture> {}
declare var GPUExternalTexture: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUExternalTexture",
  { prototype: GPUExternalTexture; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUSampler) */
interface GPUSampler extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUSampler> {}
declare var GPUSampler: Bun.__internal.UseLibWebGPUIfAvailable<"GPUSampler", { prototype: GPUSampler; new (): never }>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBindGroupLayout) */
interface GPUBindGroupLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroupLayout> {}
declare var GPUBindGroupLayout: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUBindGroupLayout",
  { prototype: GPUBindGroupLayout; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUBindGroup) */
interface GPUBindGroup extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUBindGroup> {}
declare var GPUBindGroup: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUBindGroup",
  { prototype: GPUBindGroup; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUPipelineLayout) */
interface GPUPipelineLayout extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUPipelineLayout> {}
declare var GPUPipelineLayout: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUPipelineLayout",
  { prototype: GPUPipelineLayout; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUShaderModule) */
interface GPUShaderModule extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUShaderModule> {}
declare var GPUShaderModule: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUShaderModule",
  { prototype: GPUShaderModule; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationMessage) */
interface GPUCompilationMessage extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUCompilationMessage> {}
declare var GPUCompilationMessage: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUCompilationMessage",
  { prototype: GPUCompilationMessage; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCompilationInfo) */
interface GPUCompilationInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUCompilationInfo> {}
declare var GPUCompilationInfo: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUCompilationInfo",
  { prototype: GPUCompilationInfo; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUPipelineError) */
interface GPUPipelineError extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUPipelineError> {}
declare var GPUPipelineError: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUPipelineError",
  { prototype: GPUPipelineError; new (message: string | undefined, options: GPUPipelineErrorInit): GPUPipelineError }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePipeline) */
interface GPUComputePipeline extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUComputePipeline> {}
declare var GPUComputePipeline: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUComputePipeline",
  { prototype: GPUComputePipeline; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPipeline) */
interface GPURenderPipeline extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPipeline> {}
declare var GPURenderPipeline: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPURenderPipeline",
  { prototype: GPURenderPipeline; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandBuffer) */
interface GPUCommandBuffer extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUCommandBuffer> {}
declare var GPUCommandBuffer: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUCommandBuffer",
  { prototype: GPUCommandBuffer; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUCommandEncoder) */
interface GPUCommandEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUCommandEncoder> {}
declare var GPUCommandEncoder: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUCommandEncoder",
  { prototype: GPUCommandEncoder; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder) */
interface GPUComputePassEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUComputePassEncoder> {}
declare var GPUComputePassEncoder: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUComputePassEncoder",
  { prototype: GPUComputePassEncoder; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderPassEncoder) */
interface GPURenderPassEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderPassEncoder> {}
declare var GPURenderPassEncoder: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPURenderPassEncoder",
  { prototype: GPURenderPassEncoder; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderBundle) */
interface GPURenderBundle extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderBundle> {}
declare var GPURenderBundle: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPURenderBundle",
  { prototype: GPURenderBundle; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPURenderBundleEncoder) */
interface GPURenderBundleEncoder extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPURenderBundleEncoder> {}
declare var GPURenderBundleEncoder: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPURenderBundleEncoder",
  { prototype: GPURenderBundleEncoder; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQueue) */
interface GPUQueue extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUQueue> {}
declare var GPUQueue: Bun.__internal.UseLibWebGPUIfAvailable<"GPUQueue", { prototype: GPUQueue; new (): never }>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUQuerySet) */
interface GPUQuerySet extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUQuerySet> {}
declare var GPUQuerySet: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUQuerySet",
  { prototype: GPUQuerySet; new (): never }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUDeviceLostInfo) */
interface GPUDeviceLostInfo extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUDeviceLostInfo> {}
declare var GPUDeviceLostInfo: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUDeviceLostInfo",
  { prototype: GPUDeviceLostInfo; new (): never }
>;

/**
 * What `popErrorScope()` resolves to and an `uncapturederror` event carries. It is not an `Error`.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUError)
 */
interface GPUError extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUError> {}
declare var GPUError: Bun.__internal.UseLibWebGPUIfAvailable<"GPUError", { prototype: GPUError; new (): never }>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUValidationError) */
interface GPUValidationError extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUValidationError> {}
declare var GPUValidationError: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUValidationError",
  { prototype: GPUValidationError; new (message: string): GPUValidationError }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUOutOfMemoryError) */
interface GPUOutOfMemoryError extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUOutOfMemoryError> {}
declare var GPUOutOfMemoryError: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUOutOfMemoryError",
  { prototype: GPUOutOfMemoryError; new (message: string): GPUOutOfMemoryError }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUInternalError) */
interface GPUInternalError extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUInternalError> {}
declare var GPUInternalError: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUInternalError",
  { prototype: GPUInternalError; new (message: string): GPUInternalError }
>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/GPUUncapturedErrorEvent) */
interface GPUUncapturedErrorEvent extends Bun.__internal.LibEmptyOrWebGPU<Bun.__internal.BunGPUUncapturedErrorEvent> {}
declare var GPUUncapturedErrorEvent: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUUncapturedErrorEvent",
  {
    prototype: GPUUncapturedErrorEvent;
    new (type: string, gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit): GPUUncapturedErrorEvent;
  }
>;

declare var GPUSupportedFeatures: Bun.__internal.UseLibWebGPUIfAvailable<
  "GPUSupportedFeatures",
  { prototype: Bun.WebGPU.GPUSupportedFeatures; new (): never }
>;

declare var WGSLLanguageFeatures: Bun.__internal.UseLibWebGPUIfAvailable<
  "WGSLLanguageFeatures",
  { prototype: Bun.WebGPU.WGSLLanguageFeatures; new (): never }
>;

/** The flags for {@link GPUBufferDescriptor.usage} */
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
declare var GPUBufferUsage: GPUBufferUsage;

/** The flags for {@link GPUBuffer.mapAsync} */
interface GPUMapMode {
  readonly READ: number;
  readonly WRITE: number;
}
declare var GPUMapMode: GPUMapMode;

/** The flags for {@link GPUTextureDescriptor.usage} */
interface GPUTextureUsage {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
  readonly TRANSIENT_ATTACHMENT: number;
}
declare var GPUTextureUsage: GPUTextureUsage;

/** The flags for {@link GPUBindGroupLayoutEntry.visibility} */
interface GPUShaderStage {
  readonly VERTEX: number;
  readonly FRAGMENT: number;
  readonly COMPUTE: number;
}
declare var GPUShaderStage: GPUShaderStage;

/** The flags for {@link GPUColorTargetState.writeMask} */
interface GPUColorWrite {
  readonly RED: number;
  readonly GREEN: number;
  readonly BLUE: number;
  readonly ALPHA: number;
  readonly ALL: number;
}
declare var GPUColorWrite: GPUColorWrite;
