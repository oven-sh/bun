const { kChannelHandle } = require("internal/child_process");

// Test that we can access process[kChannelHandle] when running with IPC
if (process.argv[2] === "child") {
  // In child process
  if (process.channel) {
    console.log("Has channel:", !!process.channel);
    console.log("Has kChannelHandle:", !!process[kChannelHandle]);
    console.log("Are they the same:", process.channel === process[kChannelHandle]);

    if (process[kChannelHandle]) {
      console.log("Has readStop:", typeof process[kChannelHandle].readStop);
      console.log("Has readStart:", typeof process[kChannelHandle].readStart);
    }
  }
  process.exit(0);
} else {
  // In parent process
  const { spawn } = require("child_process");
  const child = spawn(process.execPath, [__filename, "child"], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  child.stdout.on("data", data => {
    console.log(data.toString());
  });

  child.stderr.on("data", data => {
    console.error(data.toString());
  });

  child.on("exit", code => {
    console.log("Child exited with code", code);
  });
}
