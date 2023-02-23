Bun.spawn(["echo", "hello"]);
{
  const proc = Bun.spawn(["echo", "hello"], {
    cwd: "./path/to/subdir", // specify a working direcory
    env: { ...process.env, FOO: "bar" }, // specify environment variables
    onExit(proc, exitCode, signalCode, error) {
      // exit handler
    },
  });

  proc.pid; // process ID of subprocess
}

{
  const proc = Bun.spawn(["cat"], {
    stdin: await fetch(
      "https://raw.githubusercontent.com/oven-sh/bun/main/examples/hashing.js",
    ),
  });

  const text = await new Response(proc.stdout).text();
  console.log(text); // "const input = "hello world".repeat(400); ..."
}

{
  const proc = Bun.spawn(["cat"], {
    stdin: "pipe", // return a FileSink for writing
  });

  // enqueue string data
  proc.stdin!.write("hello");

  // enqueue binary data
  const enc = new TextEncoder();
  proc.stdin!.write(enc.encode(" world!"));

  // send buffered data
  proc.stdin!.flush();

  // close the input stream
  proc.stdin!.end();
}

{
  const proc = Bun.spawn(["echo", "hello"]);
  const text = await new Response(proc.stdout).text();
  console.log(text); // => "hello"
}

{
  const proc = Bun.spawn(["echo", "hello"], {
    onExit(proc, exitCode, signalCode, error) {
      // exit handler
    },
  });

  await proc.exited; // resolves when process exit
  proc.killed; // boolean — was the process killed?
  proc.exitCode; // null | number
  proc.signalCode; // null | "SIGABRT" | "SIGALRM" | ...
  proc.kill();
  proc.killed; // true

  proc.kill(); // specify an exit code
  proc.unref();
}

{
}
export {};
