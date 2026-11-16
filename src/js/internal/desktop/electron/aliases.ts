export default function provide(electron: object) {
  Bun.plugin({
    name: "bun:desktop/electron",
    setup(build) {
      const provide = (name: string, exports: object) =>
        build.module(name, () => ({ loader: "object", exports: { ...exports, default: exports } }));
      for (const suffix of ["", "/main", "/common", "/renderer", "/utility"]) provide("electron" + suffix, electron);
      for (const prefix of ["", "node:"]) provide(prefix + "original-fs", require("node:fs"));
    },
  });
}
