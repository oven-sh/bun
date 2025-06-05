const { spawn } = require("child_process");

if (process.argv[2] === "child") {
  // Child process
  const { kChannelHandle } = require("internal/child_process");

  console.log("Child: kChannelHandle is", typeof kChannelHandle);
  console.log("Child: process.channel is", typeof process.channel);
  console.log("Child: process[kChannelHandle] is", typeof process[kChannelHandle]);

  if (process[kChannelHandle]) {
    console.log("Child: readStop is", typeof process[kChannelHandle].readStop);
    console.log("Child: readStart is", typeof process[kChannelHandle].readStart);

    // Test calling these methods
    process[kChannelHandle].readStop();
    console.log("Child: Called readStop()");

    process[kChannelHandle].readStart();
    console.log("Child: Called readStart()");
  }

  process.exit(0);
} else {
  // Parent process
  const child = spawn(process.execPath, [__filename, "child"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  child.on("exit", code => {
    console.log(`Parent: Child exited with code ${code}`);
  });
}
