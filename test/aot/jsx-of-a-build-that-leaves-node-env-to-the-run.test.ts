// A program built with --env=disable reads NODE_ENV when it runs, so React picks its development or its production build then.
// Only the development build has jsxDEV: the program calls jsx, which both have.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

test("a program built with --env=disable runs its JSX under either NODE_ENV", async () => {
  using dir = tempDir("aot-jsx-env-disable", {
    "main.jsx": `const element = <div />;\nconsole.log(element.via, element.mode);\n`,
    "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
    "node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = () => ({ via: "jsx", mode: process.env.NODE_ENV });\n`,
    "node_modules/react/jsx-dev-runtime.js": `if (process.env.NODE_ENV !== "production") exports.jsxDEV = () => ({ via: "jsxDEV", mode: process.env.NODE_ENV });\n`,
  });
  const root = realpathSync(String(dir));
  const executable = join(root, "program");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--env=disable", "main.jsx", "--outfile", executable],
      root,
      { ...bunEnv, NODE_ENV: undefined },
    ),
  );
  const printed = async (NODE_ENV: string) => (await spawned([executable], root, { ...bunEnv, NODE_ENV })).stdout;

  expect({ production: await printed("production"), development: await printed("development") }).toEqual({
    production: "jsx production\n",
    development: "jsx development\n",
  });
});
