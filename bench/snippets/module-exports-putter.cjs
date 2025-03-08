// This is a stress test of some internals in How Bun does the module.exports assignment.
// If it crashes or throws then this fails
import("../runner.mjs").then(({ bench, run }) => {
  bench("Object.defineProperty(module, 'exports', { get() { return 42; } })", () => {
    Object.defineProperty(module, "exports", {
      get() {
        return 42;
      },
      set() {
        throw new Error("bad");
      },
      configurable: true,
    });
    if (module.exports !== 42) throw new Error("bad");
    if (!Object.getOwnPropertyDescriptor(module, "exports").get) throw new Error("bad");
  });

  bench("Object.defineProperty(module.exports = {})", () => {
    Object.defineProperty(module, "exports", {
      value: { abc: 123 },
    });

    if (!module.exports.abc) throw new Error("bad");
    if (Object.getOwnPropertyDescriptor(module, "exports").value !== module.exports) throw new Error("bad");
  });

  bench("module.exports = {}", () => {
    module.exports = { abc: 123 };

    if (!module.exports.abc) throw new Error("bad");
    if (Object.getOwnPropertyDescriptor(module, "exports").value !== module.exports) throw new Error("bad");
  });

  run().then(() => {
    module.exports = {
      a: 1,
    };

    const log = !process?.env?.BENCHMARK_RUNNER ? console.log : () => {};

    log(
      module?.exports,
      require.cache[module.id].exports,
      module?.exports === require.cache[module.id],
      __dirname,
      Object.keys(require(module.id)),
      require(module.id),
    );

    module.exports = function lol() {
      return 42;
    };

    log(module.exports);
    log(module.exports, module.exports());

    queueMicrotask(() => {
      log(
        module?.exports,
        require.cache[module.id].exports,
        module?.exports === require.cache[module.id]?.exports,
        __dirname,
        Object.keys(require(module.id)),
        require(module.id),
      );
    });
  });
});
