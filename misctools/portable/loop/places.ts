// Where the loop slice is built: in the output directory of misctools/portable/build.ts, next to the
// file system slice, whose sysroot, C archive and generated files it is linked against.
import { join, resolve } from "node:path";
import { REPOSITORY } from "../flags.ts";
import { ARCH, places as placesOfTheSlice } from "../slice/places.ts";

export { ARCH };

export interface Places {
  /** The output directory of misctools/portable/build.ts for `ARCH`. */
  out: string;
  sysroot: string;
  /** What build.ts of the file system slice makes. */
  slice: string;
  /** The image of the file system slice: it prints the layout of the bindings (--layout). */
  fileSystemImage: string;
  /** What build.ts of the loop slice makes. */
  loop: string;
  image: string;
  /** The Linux test host, which `bun misctools/portable/build.ts host` makes. */
  host: string;
  /** What check-windows.ts makes. */
  checked: string;
  /** The headers and libraries of Windows (../tools/windows-sdk.ts). $SDK, or <out>/winsdk. */
  sdk: string;
  /** The vendor directory of a checkout whose build has fetched it. $VENDOR, or the one of this checkout. */
  vendor: string;
  /**
   * The build directory of a portable build of bun: the headers of WebKit that bun's C++ includes, and the
   * configuration of c-ares that bun's build wrote. $PORTABLE_BUILD, or build/release-portable of this
   * checkout, which `bun misctools/portable/build.ts bun` makes.
   */
  portableBuild: string;
}

/** Takes `--out <dir>` out of the arguments. Without it: build/portable/<arch> in the repository. */
export function places(args: string[]): Places {
  const { out, slice, image: fileSystemImage, host } = placesOfTheSlice(args);
  const loop = join(out, "loop");
  return {
    out,
    sysroot: join(out, "sysroot"),
    slice,
    fileSystemImage,
    loop,
    image: join(loop, "bun_loop_slice.img"),
    host,
    checked: join(loop, "wincheck"),
    sdk: resolve(process.env.SDK ?? join(out, "winsdk")),
    vendor: resolve(process.env.VENDOR ?? join(REPOSITORY, "vendor")),
    portableBuild: resolve(process.env.PORTABLE_BUILD ?? join(REPOSITORY, "build", "release-portable")),
  };
}
