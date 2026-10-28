// A loop whose counter steps over its bound goes on for ever: whoever started the program has to end it.
function spin(bound) {
  for (let at = 0; at !== bound; at += 2);
  return "came back";
}
if (process.argv.at(-1) === "spin") {
  console.log(spin(8));
  console.log(spin(7));
} else {
  const isExecutable = process.argv[1].startsWith("/$bunfs/") || process.argv[1].startsWith("B:/~BUN/");
  const child = Bun.spawn({
    cmd: [process.execPath, ...(isExecutable ? [] : [process.argv[1]]), "spin"],
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = child.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value).trim();
  const ended = await Promise.race([
    child.exited.then(() => "ended by itself"),
    Bun.sleep(2000).then(() => "still runs"),
  ]);
  child.kill("SIGKILL");
  await child.exited;
  console.log(first.split("\n")[0], ended);
}
