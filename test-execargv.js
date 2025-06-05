const cp = require("child_process");

if (process.argv[2] === "child") {
  console.log("Child process execArgv:", process.execArgv);
  console.log("Child process argv:", process.argv);
} else {
  console.log("Parent forking child with execArgv...");
  const child = cp.fork(__filename, ["child"], {
    execArgv: ["--trace-event-categories", "node.environment"],
  });

  child.on("exit", code => {
    console.log("Child exited with code:", code);
  });
}
