import { dlopen } from "bun:ffi";

const cache = new Map();
function createHandle(addon) {
  if (cache.has(addon)) {
    return cache.get(addon);
  }

  const handle = dlopen(addon, {
    bun_mdx_rs: {
      args: ["int", "pointer", "pointer"],
      returns: ["void"],
    },
  });
  cache.set(addon, handle);
  return handle;
}
export default function loadPlugin({ addon }) {
  return {
    name: "mdx-rs",
    setup(build) {
      const handle = createHandle(addon);
      build.onBeforeParse(
        {
          filter: /\.mdx?$/,
          namespace: "file",
        },
        handle.symbols.bun_mdx_rs,
      );
    },
  };
}
