import type { BunPlugin } from "bun";
import { native } from "./native.ts";

const plugin: BunPlugin = {
  name: "bun-plugin-tailwind",
  setup(build) {
    // Not awaited: Tailwind's packages load while the bundler's threads parse the first modules.
    const loading = import("./root.ts");
    // `onLoad` reports a failure. Without a stylesheet there is nobody to report it to.
    loading.catch(() => {});
    const projectRoot = build.config?.root ?? process.cwd();
    const context = native?.twctxCreate();
    const roots = new Map<string, InstanceType<Awaited<typeof loading>["Root"]>>();
    // Bun keeps the keys of `Bun.build({ files })` with `/` separators, and gives `onLoad` such a key as the path.
    const files = new Map(
      Object.entries(build.config?.files ?? {}).map(([key, contents]) => [key.replaceAll("\\", "/"), contents]),
    );

    // The files of the module graph are scanned for candidates, natively and on the bundler's threads.
    if (native && context) {
      build.onBeforeParse(
        { filter: /^(?!.*\.css$)/ },
        { napiModule: native, symbol: "tw_on_before_parse", external: context },
      );
    }

    build.onLoad({ filter: /\.css$/ }, async ({ defer, loader, path }) => {
      const file = new Blob([files.get(path.replaceAll("\\", "/")) ?? Bun.file(path)]);

      const { Root } = await loading;
      let root = roots.get(path);
      if (!root) {
        root = new Root(path, projectRoot, context);
        roots.set(path, root);
      }

      const contents = await root.generate(await file.text(), defer);
      if (contents === false) {
        roots.delete(path);
        return;
      }

      // Bun lowers and minifies the CSS itself.
      return { contents, loader };
    });
  },
};

export default plugin;
