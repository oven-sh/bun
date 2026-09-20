import type { Tool } from "../image.ts";

/** Alpine has no python-fuse package, so it is built there; the other distros install `python3-fuse` with their packages. */
export function pythonFuse(pin: { version: string }): Tool {
  const url = `https://github.com/libfuse/python-fuse/archive/refs/tags/v${pin.version}.tar.gz`;
  return {
    name: "python-fuse",
    script: "linux/python-fuse.sh",
    variables: { PYTHON_FUSE_URL: url, PYTHON_FUSE_VERSION: pin.version },
    urls: [url],
  };
}
