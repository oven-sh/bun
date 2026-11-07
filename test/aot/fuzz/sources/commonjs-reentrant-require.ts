// Programs of ../commonjs-reentrant-require.ts, one per seed. That file describes them.
import { generate } from "../commonjs-reentrant-require";
import { Random } from "../random";
import { endless } from "../family";

export default endless("commonjs reentrant require", index => {
  const { callsUnderRequireOfModule, ...made } = generate(new Random(index + 1));
  return {
    name: `seed ${index + 1}.`,
    // Plain Bun transpiles on one thread here, so files are read in request order. Without the variable it reads them on
    // several threads and a file that `import()` asks for runs in a later turn, as it does in an executable.
    plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
    unstablePlainOutput: "as plain Bun where it reads files on several threads",
    followsExecutableWithoutCompiler: "as an executable built without --aot",
    // Plain Bun takes the steps of an `import()` call inside a `require()` that is loading an ES module: what the call names
    // runs before the `require()` returns, a running file is imported with what it has exported by then, and what it
    // throws afterwards is lost. An executable does none of that, and neither does Node.js.
    ...(callsUnderRequireOfModule && {
      meant: () => "an import() is called under a require() of an ES module, where plain Bun takes its steps at once",
    }),
    make: () => made,
  };
});
