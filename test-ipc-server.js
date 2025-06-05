const net = require("node:net");
const { fork } = require("node:child_process");

if (process.argv[2] === "child") {
  // Child process
  process.on("message", (msg, server) => {
    console.log("Child received:", msg, "server:", server);
    if (server) {
      console.log("Server is a net.Server:", server instanceof net.Server);
      server.on("connection", socket => {
        console.log("Child: Got connection");
        socket.end("Hello from child!");
      });
    }
    process.exit(0);
  });
} else {
  // Parent process
  const server = net.createServer();
  server.listen(0, () => {
    console.log("Parent: Server listening on port", server.address().port);

    const child = fork(__filename, ["child"]);
    child.on("exit", code => {
      console.log("Child exited with code", code);
      server.close();
    });

    console.log("Parent: Sending server to child");
    child.send({ what: "server" }, server);
  });
}
