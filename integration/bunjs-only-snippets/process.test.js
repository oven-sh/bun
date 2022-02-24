import { describe, it } from "bun:test";

it("process", () => {
  // this property isn't implemented yet but it should at least return a string
  const isNode = !process.isBun;

  if (!isNode && process.title !== "bun")
    throw new Error("process.title is not 'bun'");

  if (typeof process.env.USER !== "string")
    throw new Error("process.env is not an object");

  if (process.env.USER.length === 0)
    throw new Error("process.env is missing a USER property");

  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("process.platform is invalid");

  if (isNode) throw new Error("process.isBun is invalid");

  // partially to test it doesn't crash due to various strange types
  process.env.BACON = "yummy";
  if (process.env.BACON !== "yummy") {
    throw new Error("process.env is not writable");
  }

  delete process.env.BACON;
  if (typeof process.env.BACON !== "undefined") {
    throw new Error("process.env is not deletable");
  }

  process.env.BACON = "yummy";
  if (process.env.BACON !== "yummy") {
    throw new Error("process.env is not re-writable");
  }

  if (JSON.parse(JSON.stringify(process.env)).BACON !== "yummy") {
    throw new Error("process.env is not serializable");
  }

  if (typeof JSON.parse(JSON.stringify(process.env)).toJSON !== "undefined") {
    throw new Error(
      "process.env should call toJSON to hide its internal state"
    );
  }

  var { env, ...proces } = process;
  console.log(JSON.stringify(proces, null, 2));
  console.log(proces);

  console.log("CWD", process.cwd());
  console.log("SET CWD", process.chdir("../"));
  console.log("CWD", process.cwd());
});
