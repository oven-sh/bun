import type { Open } from "../native-contract/host-instances";

const requestAdapter = async () => (await navigator.gpu.requestAdapter())!;

async function requestDevice() {
  const device = await (await requestAdapter()).requestDevice();
  device.onuncapturederror = event => event.preventDefault();
  return device;
}

let sharedDevice: Promise<GPUDevice> | undefined;

function made(create: (device: GPUDevice) => object | Promise<object>): Open {
  return async () => ({ value: await create(await (sharedDevice ??= requestDevice())), close() {} });
}

const format = "rgba8unorm";
const code = `
  @compute @workgroup_size(1) fn c() {}
  @vertex fn v() -> @builtin(position) vec4f { return vec4f(); }
  @fragment fn f() -> @location(0) vec4f { return vec4f(); }`;
const createTexture = (device: GPUDevice) => device.createTexture({ size: [1], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
const compilationInfo = (device: GPUDevice) => device.createShaderModule({ code: "?" }).getCompilationInfo();

const withAdapter: Open[] = [
  async () => ({ value: await requestAdapter(), close() {} }),
  async () => {
    const device = await requestDevice();
    return { value: device, close: () => device.destroy() };
  },
  async () => {
    const device = await requestDevice();
    device.destroy();
    return { value: await device.lost, close() {} };
  },
  made(device => device.adapterInfo),
  made(device => device.features),
  made(device => device.limits),
  made(device => device.queue),
  made(device => device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST, mappedAtCreation: true })),
  made(createTexture),
  made(device => createTexture(device).createView()),
  made(device => device.createSampler()),
  made(device => device.createBindGroupLayout({ entries: [] })),
  made(device => device.createBindGroup({ layout: device.createBindGroupLayout({ entries: [] }), entries: [] })),
  made(device => device.createPipelineLayout({ bindGroupLayouts: [] })),
  made(device => device.createShaderModule({ code })),
  made(compilationInfo),
  made(async device => (await compilationInfo(device)).messages[0]),
  made(device => device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }) } })),
  made(device => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({ layout: "auto", vertex: { module }, fragment: { module, targets: [{ format }] } });
  }),
  made(device => device.createQuerySet({ type: "occlusion", count: 1 })),
  made(device => device.createCommandEncoder()),
  made(device => device.createCommandEncoder().finish()),
  made(device => device.createCommandEncoder().beginComputePass()),
  made(device => device.createCommandEncoder().beginRenderPass({ colorAttachments: [{ view: createTexture(device), loadOp: "clear", storeOp: "store" }] })),
  made(device => device.createRenderBundleEncoder({ colorFormats: [format] })),
  made(device => device.createRenderBundleEncoder({ colorFormats: [format] }).finish()),
];

export const openersOfWebGPU: Open[] = [
  () => ({ value: navigator.gpu, close() {} }),
  () => ({ value: navigator.gpu.wgslLanguageFeatures, close() {} }),
  () => ({ value: new GPUValidationError("text"), close() {} }),
  () => ({ value: new GPUPipelineError("text", { reason: "internal" }), close() {} }),
  ...((await requestAdapter()) ? withAdapter : []),
];
