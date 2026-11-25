// A child that drops the listeners of process.stdin and destroys it ends while its writer is still open, on a pipe and, but for Windows, on a terminal.
// The child is this program again. It is handed a word.
if (process.argv.length > 2) {
  const stdin = process.stdin;
  stdin.once("data", chunk => {
    console.log("data " + String(chunk).trim());
    stdin.removeAllListeners();
    stdin.destroy();
    stdin.on("close", hadError => console.log("close " + hadError));
  });
  console.log("ready");
} else {
  const again = [process.execPath, process.argv[1], "child"];
  // A child that waits for the end of its input is ended after a while, and what is printed says so.
  const late = "the child waited for the end of its input\n";

  const onPipe = Bun.spawn(again, { stdin: "pipe", stdout: "pipe" });
  const decoder = new TextDecoder();
  let text = "";
  let patience = setTimeout(() => {
    text += late;
    onPipe.stdin.end();
  }, 30_000);
  for await (const bytes of onPipe.stdout) {
    const ready = text.includes("ready\n");
    text += decoder.decode(bytes, { stream: true });
    if (!ready && text.includes("ready\n")) {
      onPipe.stdin.write("one\n");
      onPipe.stdin.flush();
    }
  }
  clearTimeout(patience);
  console.log("pipe:", JSON.stringify(text), await onPipe.exited);
  onPipe.stdin.end();

  // A terminal of Windows shows more than what the child writes, the path of the program among it.
  if (process.platform !== "win32") {
    // The terminal repeats the line that is typed, and makes "\r\n" of the end of each line.
    // It also shows what the child writes to stderr, so the child is not asked to say there how it was built.
    const { BUN_AOT_VERBOSE: _, ...env } = process.env;
    const closed = Promise.withResolvers();
    const ofTerminal = new TextDecoder();
    let seen = "";
    const onTerminal = Bun.spawn(again, {
      env,
      terminal: {
        data(terminal, bytes) {
          const ready = seen.includes("ready\r\n");
          seen += ofTerminal.decode(bytes, { stream: true });
          // The line is typed behind the whole line of the child, and the last line of the child is awaited whole: the bytes come in any pieces.
          if (!ready && seen.includes("ready\r\n")) terminal.write("one\n");
          if (/close \w+\r\n/.test(seen)) closed.resolve();
        },
        exit() {
          closed.resolve();
        },
      },
    });
    patience = setTimeout(() => {
      seen += late;
      onTerminal.kill();
    }, 30_000);
    await closed.promise;
    clearTimeout(patience);
    console.log("terminal:", JSON.stringify(seen.replaceAll("\r", "")), await onTerminal.exited);
    onTerminal.terminal.close();
  }
}
