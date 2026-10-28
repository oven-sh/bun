// A callback of the program throws under a function of the host. Prints what the call sites and the stack say the functions are called.
const failing = message => () => {
  throw new Error(message);
};
const cases = {
  "Buffer.from": () => Buffer.from({ valueOf: failing("valueOf") }),
  "Buffer.from a number": () => Buffer.from(5),
  "console.write": () => console.write({}),
  "process.loadEnvFile": () => process.loadEnvFile("/does/not/exist/.env"),
  "Glob.prototype.scanSync": () =>
    new Bun.Glob("*")
      .scanSync({
        get cwd() {
          throw new Error("cwd");
        },
      })
      .next(),
  "new ReadableStream": () => new ReadableStream({ start: failing("start") }),
  "JSON.stringify of a buffer": () =>
    JSON.stringify({
      toJSON: Buffer.prototype.toJSON,
      get length() {
        throw new Error("length");
      },
    }),
};
const thrownBy = run => {
  try {
    run();
  } catch (error) {
    return error;
  }
};
const describeFrame = line => {
  const [, name, place] = /^    at (?:(.*) \()?(.*?)\)?$/.exec(line);
  return [name ?? "", /^(native|unknown)/.exec(place)?.[1] ?? "file"];
};
for (const [label, run] of Object.entries(cases)) {
  const frames = String(thrownBy(run)?.stack)
    .split("\n")
    .filter(line => line.startsWith("    at "));
  console.log(label, JSON.stringify(frames.slice(0, 4).map(describeFrame)));
}
Error.prepareStackTrace = (error, sites) =>
  sites.slice(0, 4).map(site => [site.getFunctionName(), site.getMethodName(), site.isNative()]);
for (const [label, run] of Object.entries(cases)) console.log(label, JSON.stringify(thrownBy(run)?.stack));
