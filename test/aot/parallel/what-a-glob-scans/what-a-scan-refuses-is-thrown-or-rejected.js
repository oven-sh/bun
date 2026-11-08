// What native code refuses of the operands is thrown by the call; what the walk meets later is the reason of a rejection.
const glob = new Bun.Glob("*");

function refusalOf(run) {
  try {
    return `nothing is thrown: ${typeof run()}`;
  } catch (error) {
    return `${error.name} ${String(error.code)} ${error.message}`;
  }
}

for (const scan of [glob.scanSync, glob.scan]) {
  console.log(refusalOf(() => scan.call(glob, 5)));
  console.log(refusalOf(() => scan.call(glob, { cwd: 5 })));
  console.log(refusalOf(() => scan.call(glob, "a\0b")));
  console.log(refusalOf(() => scan.call({}, ".")));
  console.log(refusalOf(() => scan.call(undefined, ".")));
  console.log(refusalOf(() => scan.call(glob, Symbol("made-up"))));
}
console.log(refusalOf(() => [...glob.scanSync("/a-folder-that-is-not-there/made-up")]).slice(0, 12));
try {
  await glob.scan("/a-folder-that-is-not-there/made-up").next();
  console.log("nothing is rejected");
} catch (error) {
  console.log(error.name, String(error.code), error.syscall, String(error instanceof Error));
}
