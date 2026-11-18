import { readFileSync } from "node:fs";
import * as b from "../../../codegen/bindgen-lib.ts";
import { PredefinedColorSpace } from "../canvas/canvas.bind.ts";
import { DesktopEvent, DesktopEventInit } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::webgl", feature: "Desktop", membersInTable: false, isCold: true });

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const [, ofWebGL1, ofWebGL2, ofExtensions] = read("abi_webgl_constants.rs")
  .split(/^ {4}\/\/ .*$/m)
  .map(part =>
    Object.fromEntries(
      [...part.matchAll(/(\w+) (0x\w+)/g)].map(([, name, value]) => [
        name.replace(/(\d)X(\d)/, "$1x$2"),
        Number(value),
      ]),
    ),
  );
const abi = read("abi_webgl.rs");

const webidl = { webidl: true } as const;
const exposed = ["Window", "Worker"] as const;
const heap = { capability: "heap" } as const;
const answers = { returns: b.any, capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const text = b.DOMString.utf8;
const [number, float, flag, large] = [b.u32.wrap, b.unrestrictedFloat, b.bool.loose, b.i64.wrap];
const each = <T>(names: string, type: T) => Object.fromEntries(names.split(" ").map(name => [name, type]));
const numbers = (names: string) => each(names, number);
const view = b.typedArray("ArrayBufferView").allowShared;
const list = (array: "Float32Array" | "Int32Array" | "Uint32Array", element: typeof float | typeof number) =>
  b.union({ array: b.typedArray(array).allowShared, sequence: b.sequenceVec(element) }, webidl);

const called = new Set(
  `activeTexture bindBuffer bindBufferBase bindBufferRange bindFramebuffer bindTexture bindVertexArray blendFunc clear depthMask disable drawArrays
  drawArraysInstanced drawElements drawElementsInstanced enable enableVertexAttribArray scissor useProgram vertexAttribPointer viewport`.split(
    /\s+/,
  ),
);

/** The members that only pass their arguments on. */
function commands(owner: string, suffix = "") {
  const types: Record<string, any> = { u32: number, f32: float, bool: flag, i64: large };
  const type = (name: string) =>
    types[name] ?? (name.startsWith("Option") ? b.ref(name.slice(8, -1)).nullable : b.ref(name.slice(1)));
  const sections = abi.matchAll(new RegExp(`(send|bind|draw|ask) ${owner} {(.*?)}`, "gs"));
  return Object.fromEntries(
    [...sections].flatMap(([, kind, body]) =>
      [...body.matchAll(/(\w)(\w+) (\w+)\((.*?)\)/g)].map(([, first, rest, rustName, args]) => {
        const name = first.toLowerCase() + rest + suffix;
        const pairs = [...args.matchAll(/(\w+): ([^,]+)/g)].map(([, arg, it]) => [arg, type(it)]);
        return [
          name,
          { rustName, args: Object.fromEntries(pairs), isCold: !called.has(name), ...(kind === "ask" && answers) },
        ];
      }),
    ),
  );
}

export const WebGLPowerPreference = b.enumeration(["default", "low-power", "high-performance"]);
export const WebGLContextAttributes = b.dictionary(
  {
    alpha: flag.default(true),
    antialias: flag.default(true),
    depth: flag.default(true),
    desynchronized: flag.default(false),
    failIfMajorPerformanceCaveat: flag.default(false),
    powerPreference: WebGLPowerPreference.default("default"),
    premultipliedAlpha: flag.default(true),
    preserveDrawingBuffer: flag.default(false),
    stencil: flag.default(false),
  },
  { ...webidl, fromJS: true, nonObjectAsEmpty: true },
);
export const WebGLActualAttributes = b.dictionary({
  ...each("alpha antialias depth desynchronized failIfMajorPerformanceCaveat", b.bool),
  powerPreference: WebGLPowerPreference,
  ...each("premultipliedAlpha preserveDrawingBuffer stencil", b.bool),
});

export const WebGLContextEventInit = b.dictionary(
  { statusMessage: b.DOMString.impl.default("") },
  { ...webidl, extends: DesktopEventInit },
);
export const WebGLContextEvent = b.interface("WebGLContextEvent", {
  extends: DesktopEvent,
  rustPath: "crate::api::webgl::WebGLContextEvent",
  exposed,
  construct: {
    args: { type: b.DOMString.atom.as("crate::api::core::Atom"), eventInit: WebGLContextEventInit.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: { statusMessage: { getter: b.DOMString.impl.as("crate::api::core::DomString") } },
});

export const WebGLObject = b.interface("WebGLObject", {
  rustPath: "crate::api::webgl::Object",
  exposed,
  internalFields: { nextHeld: b.ref("WebGLObject") },
  proto: { label: { getter: b.USVString.utf8, setter: true } },
});
const object = (name: string) => b.interface(name, { extends: WebGLObject, exposed });
export const WebGLBuffer = object("WebGLBuffer");
export const WebGLFramebuffer = object("WebGLFramebuffer");
export const WebGLProgram = object("WebGLProgram");
export const WebGLQuery = object("WebGLQuery");
export const WebGLRenderbuffer = object("WebGLRenderbuffer");
export const WebGLSampler = object("WebGLSampler");
export const WebGLShader = object("WebGLShader");
export const WebGLSync = object("WebGLSync");
export const WebGLTexture = object("WebGLTexture");
export const WebGLTransformFeedback = object("WebGLTransformFeedback");
export const WebGLVertexArrayObject = object("WebGLVertexArrayObject");
export const WebGLTimerQueryEXT = b.interface("WebGLTimerQueryEXT", { extends: WebGLObject, noInterfaceObject: true });
export const WebGLVertexArrayObjectOES = b.interface("WebGLVertexArrayObjectOES", {
  extends: WebGLObject,
  noInterfaceObject: true,
});

export const WebGLUniformLocation = b.interface("WebGLUniformLocation", {
  rustPath: "crate::api::webgl::WebGLUniformLocation",
  exposed,
});
export const WebGLActiveInfo = b.interface("WebGLActiveInfo", {
  rustPath: "crate::api::webgl::WebGLActiveInfo",
  exposed,
  proto: { size: { getter: b.u32 }, type: { getter: b.u32 }, name: { getter: text } },
});
export const WebGLShaderPrecisionFormat = b.interface("WebGLShaderPrecisionFormat", {
  rustPath: "crate::api::webgl::WebGLShaderPrecisionFormat",
  exposed,
  proto: each("rangeMin rangeMax precision", { getter: b.u32 }),
});

export const Float32List = list("Float32Array", float);
export const Int32List = list("Int32Array", number);
export const Uint32List = list("Uint32Array", number);
const sources = {
  bitmap: b.ref("ImageBitmap"),
  data: b.ref("ImageData"),
  image: b.ref("HTMLImageElement"),
  canvas: b.ref("HTMLCanvasElement"),
  video: b.ref("HTMLVideoElement"),
  offscreen: b.ref("OffscreenCanvas"),
};
export const TexImageSource = b.union(sources, webidl);
// A union stands for the overloads that differ in one argument.
export const TexImagePixels = b.union({ ...sources, view, offset: large }, webidl);
export const ViewOrNumber = b.union({ view, number: large }, webidl);
export const BufferOrSize = b.union({ data: b.bufferSource.allowShared, size: large }, webidl);

export const WebGL = b.interface("WebGL", {
  abstract: true,
  rustPath: "crate::api::webgl::Context",
  internalFields: { canvas: b.any, extensions: b.any, backing: b.ref("Canvas2D"), held: WebGLObject },
  estimatedSize: true,
});

const lifeCycle = (names: string, suffix = "", type = (name: string) => b.ref(`WebGL${name}`)) =>
  Object.fromEntries(
    names
      .split(" ")
      .flatMap(name => [
        ...(name === "Shader" || name === "Sync" ? [] : [[`create${name}${suffix}`, { returns: b.any, ...heap }]]),
        [`delete${name}${suffix}`, { args: { object: type(name).nullable } }],
        [`is${name}${suffix}`, { args: { object: type(name).nullable }, ...answers }],
      ]),
  );
const location = WebGLUniformLocation.nullable;
const part = { srcOffset: large.default(0), srcLength: number.default(0) };
const sizes = [1, 2, 3, 4];
const components = (size: number, type: any) => each("x y z w".slice(0, 2 * size - 1), type);
const uniforms = (letters: string, type: any, many: any) =>
  Object.fromEntries(
    sizes.flatMap(size => [
      [`uniform${size}${letters}`, { args: { location, ...components(size, type) }, isCold: letters === "ui" }],
      [`uniform${size}${letters}v`, { args: { location, data: many, ...part }, isCold: letters !== "f", ...heap }],
    ]),
  );
const matrices = (shapes: string) =>
  Object.fromEntries(
    shapes
      .split(" ")
      .map(it => [
        `uniformMatrix${it}fv`,
        { args: { location, transpose: flag, data: Float32List, ...part }, isCold: it.length > 1, ...heap },
      ]),
  );
const named = { args: { program: WebGLProgram, name: text }, ...answers };
const pixels = { pixels: TexImagePixels.nullable, srcOffset: large.default(0) };
const blocks = { data: ViewOrNumber, offset: large.optional, srcLengthOverride: number.optional };
const colorSpace = { getter: PredefinedColorSpace, setter: true, ignoreInvalid: true } as const;

/** With the overloads of WebGL 2, which the bodies refuse in WebGL 1. */
export const WebGLRenderingContextBase = b.mixin("WebGLRenderingContextBase", {
  on: WebGL,
  constants: ofWebGL1,
  proto: {
    canvas: { getter: b.object, field: "canvas" },
    ...each("drawingBufferWidth drawingBufferHeight drawingBufferFormat", { getter: b.u32 }),
    ...each("drawingBufferColorSpace unpackColorSpace", colorSpace),
    getContextAttributes: { returns: WebGLActualAttributes.nullable, ...heap },
    isContextLost: { returns: b.bool, ...heap },
    getSupportedExtensions: answers,
    getExtension: { args: { name: text }, returns: b.any, ...heap },
    drawingBufferStorage: { args: numbers("sizedFormat width height") },
    ...commands("WebGLRenderingContextBase"),
    ...lifeCycle("Buffer Framebuffer Program Renderbuffer Shader Texture"),
    ...uniforms("f", float, Float32List),
    ...uniforms("i", number, Int32List),
    ...matrices("2 3 4"),
    ...Object.fromEntries(
      sizes.flatMap(size => [
        [`vertexAttrib${size}f`, { args: { index: number, ...components(size, float) } }],
        [`vertexAttrib${size}fv`, { args: { index: number, values: Float32List }, ...heap }],
      ]),
    ),
    bindAttribLocation: { args: { program: WebGLProgram, index: number, name: text } },
    bufferData: [
      { rustName: "buffer_data", args: { target: number, data: BufferOrSize.nullable, usage: number }, ...heap },
      {
        rustName: "buffer_data_from_part",
        args: { target: number, data: view, usage: number, srcOffset: large, length: number.default(0) },
        ...heap,
      },
    ],
    bufferSubData: [
      {
        rustName: "buffer_sub_data",
        args: { target: number, offset: large, data: b.bufferSource.allowShared },
        isCold: false,
        ...heap,
      },
      {
        rustName: "buffer_sub_data_from_part",
        args: { target: number, offset: large, data: view, srcOffset: large, length: number.default(0) },
        isCold: false,
        ...heap,
      },
    ],
    compileShader: { args: { shader: WebGLShader } },
    compressedTexImage2D: {
      rustName: "compressed_tex_image_2d",
      args: { ...numbers("target level internalformat width height border"), ...blocks },
      ...js,
    },
    compressedTexSubImage2D: {
      rustName: "compressed_tex_sub_image_2d",
      args: { ...numbers("target level xoffset yoffset width height format"), ...blocks },
      ...js,
    },
    createShader: { args: { type: number }, returns: b.any, ...heap },
    finish: {},
    flush: {},
    getAttribLocation: named,
    getError: { returns: b.u32, ...heap },
    getProgramParameter: { args: { program: WebGLProgram, pname: number }, ...answers },
    getShaderParameter: { args: { shader: WebGLShader, pname: number }, ...answers },
    getUniformLocation: named,
    linkProgram: { args: { program: WebGLProgram } },
    pixelStorei: { args: numbers("pname param") },
    readPixels: {
      args: { ...numbers("x y width height format type"), pixels: ViewOrNumber.nullable, dstOffset: large.default(0) },
      ...js,
    },
    shaderSource: { args: { shader: WebGLShader, source: text } },
    texImage2D: [
      {
        rustName: "tex_image_2d",
        args: { ...numbers("target level internalformat width height border format type"), ...pixels },
        ...js,
      },
      {
        rustName: "tex_image_2d_from_source",
        args: { ...numbers("target level internalformat format type"), source: TexImageSource },
        ...js,
      },
    ],
    texSubImage2D: [
      {
        rustName: "tex_sub_image_2d",
        args: { ...numbers("target level xoffset yoffset width height format type"), ...pixels },
        ...js,
      },
      {
        rustName: "tex_sub_image_2d_from_source",
        args: { ...numbers("target level xoffset yoffset format type"), source: TexImageSource },
        ...js,
      },
    ],
  },
});

const enums = b.sequenceVec(number);
const clears = (values: any) => ({
  args: { ...numbers("buffer drawbuffer"), values, srcOffset: large.default(0) },
  ...heap,
});

export const WebGL2RenderingContextBase = b.mixin("WebGL2RenderingContextBase", {
  on: WebGL,
  constants: { ...ofWebGL2, TIMEOUT_IGNORED: -1 },
  proto: {
    ...commands("WebGL2RenderingContextBase"),
    ...lifeCycle("Query Sampler Sync TransformFeedback"),
    ...lifeCycle("VertexArray", "", () => b.ref("WebGLVertexArrayObject")),
    ...uniforms("ui", number, Uint32List),
    ...matrices("2x3 2x4 3x2 3x4 4x2 4x3"),
    clearBufferfv: clears(Float32List),
    clearBufferiv: clears(Int32List),
    clearBufferuiv: clears(Uint32List),
    clientWaitSync: { args: { sync: WebGLSync, flags: number, timeout: large }, ...answers },
    compressedTexImage3D: {
      rustName: "compressed_tex_image_3d",
      args: { ...numbers("target level internalformat width height depth border"), ...blocks },
      ...js,
    },
    compressedTexSubImage3D: {
      rustName: "compressed_tex_sub_image_3d",
      args: { ...numbers("target level xoffset yoffset zoffset width height depth format"), ...blocks },
      ...js,
    },
    drawBuffers: { args: { buffers: enums } },
    fenceSync: { args: numbers("condition flags"), returns: b.any, ...heap },
    getActiveUniforms: { args: { program: WebGLProgram, uniformIndices: enums, pname: number }, ...answers },
    getBufferSubData: {
      args: {
        target: number,
        srcByteOffset: large,
        dstBuffer: view,
        dstOffset: large.default(0),
        length: number.default(0),
      },
      ...heap,
    },
    getFragDataLocation: named,
    getQueryParameter: { args: { query: WebGLQuery, pname: number }, ...answers },
    getSyncParameter: { args: { sync: WebGLSync, pname: number }, ...answers },
    getUniformBlockIndex: named,
    getUniformIndices: { args: { program: WebGLProgram, uniformNames: b.sequenceVec(text.owned) }, ...answers },
    invalidateFramebuffer: { args: { target: number, attachments: enums } },
    invalidateSubFramebuffer: { args: { target: number, attachments: enums, ...numbers("x y width height") } },
    texImage3D: {
      rustName: "tex_image_3d",
      args: { ...numbers("target level internalformat width height depth border format type"), ...pixels },
      ...js,
    },
    texSubImage3D: {
      rustName: "tex_sub_image_3d",
      args: { ...numbers("target level xoffset yoffset zoffset width height depth format type"), ...pixels },
      ...js,
    },
    transformFeedbackVaryings: {
      args: { program: WebGLProgram, varyings: b.sequenceVec(text.owned), bufferMode: number },
    },
    vertexAttribI4i: { args: numbers("index x y z w") },
    vertexAttribI4iv: { args: { index: number, values: Int32List }, ...heap },
    vertexAttribI4ui: { args: numbers("index x y z w") },
    vertexAttribI4uiv: { args: { index: number, values: Uint32List }, ...heap },
    waitSync: { args: { sync: WebGLSync, flags: number, timeout: large } },
  },
});

export const WebGLRenderingContext = b.interface("WebGLRenderingContext", {
  extends: WebGL,
  exposed,
  includes: [WebGLRenderingContextBase],
});
export const WebGL2RenderingContext = b.interface("WebGL2RenderingContext", {
  extends: WebGL,
  exposed,
  includes: [WebGLRenderingContextBase, WebGL2RenderingContextBase],
});

export const WebGLExtension = b.interface("WebGLExtension", {
  abstract: true,
  rustPath: "crate::api::webgl::Extension",
  internalFields: { context: WebGL },
});

/** It has the constants whose names match. */
const extension = (name: string, matching = /^$/, proto = {}, more = {}) =>
  b.interface(`Gl${name}`, {
    name: new RegExp(`\\b${name} (\\w+) \\d`).exec(abi)![1],
    extends: WebGLExtension,
    noInterfaceObject: true,
    constants: { ...Object.fromEntries(Object.entries(ofExtensions).filter(([it]) => matching.test(it))), ...more },
    proto,
  });
const timer = WebGLTimerQueryEXT;
const lists = (names: string) =>
  Object.fromEntries(
    names.split(" ").flatMap(it => [
      [`${it}List`, Int32List],
      [`${it}Offset`, large],
    ]),
  );
const sixteen = (name: string, first: number) =>
  Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`${name}${i}_WEBGL`, first + i]));

export const GlInstancedArrays = extension("InstancedArrays", /DIVISOR/, {
  drawArraysInstancedANGLE: { args: numbers("mode first count primcount") },
  drawElementsInstancedANGLE: { args: { ...numbers("mode count type"), offset: large, primcount: number } },
  vertexAttribDivisorANGLE: { args: numbers("index divisor") },
});
export const GlBlendMinmax = extension("BlendMinmax", /^M.._EXT/);
export const GlClipControl = extension(
  "ClipControl",
  /_LEFT|TO_ONE|^CLIP_[^_]+_(MODE_)?EXT/,
  commands("GlClipControl", "EXT"),
);
export const GlColorBufferFloat2 = extension("ColorBufferFloat2");
export const GlColorBufferHalfFloat = extension("ColorBufferHalfFloat", /16F|COMPONENT_TYPE|NORMALIZED/);
export const GlConservativeDepth = extension("ConservativeDepth");
export const GlDepthClamp = extension("DepthClamp", /DEPTH_CLAMP/);
export const GlTimerQuery = extension("TimerQuery", /QUERY|TIME|DISJOINT/, {
  ...lifeCycle("Query", "EXT", () => timer),
  beginQueryEXT: { args: { target: number, query: timer } },
  endQueryEXT: { args: { target: number } },
  queryCounterEXT: { args: { query: timer, target: number } },
  getQueryEXT: { args: numbers("target pname"), ...answers },
  getQueryObjectEXT: { args: { query: timer, pname: number }, ...answers },
});
export const GlTimerQuery2 = extension("TimerQuery2", /COUNTER|TIME|DISJOINT/, commands("GlTimerQuery2", "EXT"));
export const GlFloatBlend = extension("FloatBlend");
export const GlFragDepth = extension("FragDepth");
export const GlPolygonOffsetClamp = extension(
  "PolygonOffsetClamp",
  /OFFSET_CLAMP/,
  commands("GlPolygonOffsetClamp", "EXT"),
);
export const GlRenderSnorm = extension("RenderSnorm");
export const GlTextureLod = extension("TextureLod");
export const GlBptc = extension("Bptc", /BPTC/);
export const GlRgtc = extension("Rgtc", /RGTC/);
export const GlAnisotropic = extension("Anisotropic", /ANISOTROPY/);
export const GlMirrorClamp = extension("MirrorClamp", /MIRROR/);
export const GlNorm16 = extension("Norm16", /16_/);
export const GlSrgb = extension("Srgb", /^SRGB|ENCODING/);
export const GlParallelCompile = extension("ParallelCompile", /COMPLETION/);
export const GlNoperspective = extension("Noperspective");
export const GlDrawBuffersIndexed = extension("DrawBuffersIndexed", undefined, commands("GlDrawBuffersIndexed", "OES"));
export const GlElementIndexUint = extension("ElementIndexUint");
export const GlRenderMipmap = extension("RenderMipmap");
export const GlSampleVariables = extension("SampleVariables");
export const GlInterpolation = extension("Interpolation", /INTERPOLATION/);
export const GlDerivatives = extension("Derivatives", /DERIVATIVE/);
export const GlTextureFloat = extension("TextureFloat");
export const GlFloatLinear = extension("FloatLinear");
export const GlTextureHalfFloat = extension("TextureHalfFloat", /HALF_FLOAT/);
export const GlHalfFloatLinear = extension("HalfFloatLinear");
export const GlVertexArrayObject = extension("VertexArrayObject", /ARRAY_BINDING/, {
  ...lifeCycle("VertexArray", "OES", () => WebGLVertexArrayObjectOES),
  bindVertexArrayOES: { args: { arrayObject: WebGLVertexArrayObjectOES.nullable } },
});
export const GlDualSource = extension("DualSource", /SRC1|DUAL/);
export const GlClipCull = extension("ClipCull", /DISTANCE/);
export const GlColorBufferFloat = extension("ColorBufferFloat", /32F|COMPONENT_TYPE|NORMALIZED/);
export const GlAstc = extension("Astc", /ASTC/, { getSupportedProfiles: answers });
export const GlEtc = extension("Etc", /ETC2|EAC/);
export const GlEtc1 = extension("Etc1", /ETC1/);
export const GlS3tc = extension("S3tc", /_RGBA?_S3TC/);
export const GlS3tcSrgb = extension("S3tcSrgb", /_SRGB.*S3TC/);
export const GlRendererInfo = extension("RendererInfo", /UNMASKED/);
export const GlDebugShaders = extension("DebugShaders", undefined, commands("GlDebugShaders"));
export const GlDepthTexture = extension("DepthTexture", /24_8/);
export const GlDrawBuffers = extension(
  "DrawBuffers",
  /^MAX_(COLOR|DRAW)/,
  { drawBuffersWEBGL: { args: { buffers: enums } } },
  { ...sixteen("COLOR_ATTACHMENT", ofWebGL1.COLOR_ATTACHMENT0), ...sixteen("DRAW_BUFFER", ofWebGL2.DRAW_BUFFER0) },
);
export const GlLoseContext = extension("LoseContext", undefined, each("loseContext restoreContext", heap));
export const GlMultiDraw = extension("MultiDraw", undefined, {
  multiDrawArraysWEBGL: { args: { mode: number, ...lists("firsts counts"), drawcount: number }, ...heap },
  multiDrawElementsWEBGL: {
    args: { mode: number, ...lists("counts"), type: number, ...lists("offsets"), drawcount: number },
    ...heap,
  },
  multiDrawArraysInstancedWEBGL: {
    args: { mode: number, ...lists("firsts counts instanceCounts"), drawcount: number },
    ...heap,
  },
  multiDrawElementsInstancedWEBGL: {
    args: { mode: number, ...lists("counts"), type: number, ...lists("offsets instanceCounts"), drawcount: number },
    ...heap,
  },
});
export const GlPolygonMode = extension("PolygonMode", /POLYGON_MODE|LINE_|FILL_/, commands("GlPolygonMode", "WEBGL"));
export const GlProvokingVertex = extension(
  "ProvokingVertex",
  /CONVENTION|PROVOKING/,
  commands("GlProvokingVertex", "WEBGL"),
);
export const GlSharedExponent = extension("SharedExponent");
export const GlStencilTexturing = extension("StencilTexturing", /STENCIL/);
