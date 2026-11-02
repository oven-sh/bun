// Stack frames below the callbacks of next tick.
const framesOf = stack =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/\(.*[\\/]/, "(")
        .replace(/native:\d+:\d+/, "native"),
    )
    .join(" < ");

function sitesOf(error) {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) =>
    sites
      .map(site =>
        [
          site.getFunctionName(),
          site.getMethodName(),
          site.getTypeName(),
          site.isNative(),
          site.isToplevel(),
          site.isConstructor(),
          site.isAsync(),
          site.isNative() ? typeof site.getLineNumber() : site.getLineNumber(),
          site.isNative() ? typeof site.getColumnNumber() : site.getColumnNumber(),
          typeof site.getFunction(),
          typeof site.getThis(),
          String(site).replace(/\(.*[\\/]/, "("),
        ].join(" "),
      )
      .join(" < ");
  const text = error.stack;
  Error.prepareStackTrace = before;
  return text;
}

const { nextTick } = process;
console.log(Function.prototype.toString.call(nextTick), nextTick.name, nextTick.length, Reflect.ownKeys(nextTick));

for (let count = 0; count <= 6; count++) {
  process.nextTick(
    function named(...args) {
      console.log("arguments", args.length, framesOf(new Error().stack));
    },
    ...Array.from({ length: count }, (_, index) => index),
  );
}
process.nextTick(() => console.log("sites", sitesOf(new Error())));
process.nextTick(() => {
  const holder = {};
  Error.captureStackTrace(holder);
  console.log("captured", framesOf(holder.stack));
});
process.nextTick(() => Promise.resolve().then(() => console.log("job in a tick", framesOf(new Error().stack))));
process.nextTick(async () => {
  await 0;
  console.log("behind an await in a tick", framesOf(new Error().stack));
});
process.nextTick(() => process.nextTick(() => console.log("tick in a tick", framesOf(new Error().stack))));
queueMicrotask(() => process.nextTick(() => console.log("tick in a job", framesOf(new Error().stack))));
setTimeout(() => process.nextTick(() => console.log("tick in a timer", framesOf(new Error().stack))), 0);

let caught = 0;
process.on("uncaughtException", (error, origin) => console.log("caught", ++caught, origin, framesOf(error?.stack)));
process.nextTick(() => {
  throw new Error("thrown in a tick");
});
process.nextTick(() => null.member);
process.nextTick(callee => callee(), 1);
process.nextTick(JSON.parse, "{");
process.nextTick(Array.prototype.map);
