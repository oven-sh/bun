// Where the file system slice is built: in the output directory of misctools/portable/build.ts.
import { join, resolve } from "node:path";
import { REPOSITORY } from "../flags.ts";

/** The slice has bun's code for Windows, which is written for x86-64 in the image. */
export const ARCH = "x86_64";

export interface Places {
  /** The output directory of misctools/portable/build.ts for `ARCH`. */
  out: string;
  /** What build.ts of the slice makes. */
  slice: string;
  image: string;
  /** The Linux test host, which `bun misctools/portable/build.ts host` makes. */
  host: string;
}

/** Takes `--out <dir>` out of the arguments. Without it: build/portable/<arch> in the repository. */
export function places(args: string[]): Places {
  const at = args.indexOf("--out");
  const option = at >= 0 ? args.splice(at, 2)[1] : undefined;
  if (at >= 0 && option === undefined) throw new Error("--out needs a directory");
  const out = resolve(option ?? join(REPOSITORY, "build", "portable", ARCH));
  const slice = join(out, "slice");
  return { out, slice, image: join(slice, "bun_fs_slice.img"), host: join(out, "host-linux") };
}
