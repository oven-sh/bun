const { fork } = require("child_process");
const net = require("net");

// Test the serialize function directly
const ipc = require("../../src/js/builtins/Ipc.ts");

if (process.argv[2] === "test-serialize") {
  // Test serialization
  const server = net.createServer();

  server.listen(0, () => {
    const socket = net.connect(server.address().port);

    socket.on("connect", () => {
      console.log("Testing serialize function...");

      const result = ipc.serialize({ test: "message" }, socket, {});

      if (result) {
        console.log("Serialization result:", result);
        console.log("Handle type:", result[1].type);
        console.log("Message:", result[1].message);
      } else {
        console.log("Serialization returned null");
      }

      process.exit(0);
    });
  });
} else if (process.argv[2] === "child") {
  process.on("message", (msg, handle) => {
    console.log("Child received message:", msg);
    console.log("Child received handle:", handle);

    if (handle && handle.end) {
      handle.end("echo");
      console.log("Child sent echo");
    } else {
      console.error("Handle is undefined or missing end method");
    }
  });

  process.send({ what: "ready" });
} else {
  // Parent process
  const child = fork(process.argv[1], ["child"]);

  child.on("message", msg => {
    if (msg.what === "ready") {
      console.log("Child is ready, creating socket...");

      const server = net.createServer();
      server.on("connection", socket => {
        console.log("Got connection, sending socket to child...");
        child.send({ what: "socket" }, socket);
      });

      server.listen(0, () => {
        const client = net.connect(server.address().port);
        client.on("data", data => {
          console.log("Parent received:", data.toString());
          client.end();
          server.close();
          process.exit(0);
        });
      });
    }
  });

  child.on("exit", code => {
    console.log("Child exited with code:", code);
  });
}
