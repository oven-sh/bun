const child = Bun.spawn(["echo", "hello"], {
  onExit(passed, exitCode, signalCode, error) {
    console.log(typeof passed, exitCode + 1, signalCode === null, error === undefined);
  },
});
console.log((await child.exited) + 1, (await new Response(child.stdout).text()).length);
