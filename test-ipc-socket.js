const cp = require("child_process");
const net = require("net");

if (process.argv[2] !== "child") {
  // Parent process
  console.log("[Parent] Starting test...");

  const child = cp.fork(__filename, ["child"]);

  child.on("exit", code => {
    console.log("[Parent] Child exited with code:", code);
  });

  child.on("message", msg => {
    console.log("[Parent] Received message from child:", msg);
  });

  const server = net.createServer(socket => {
    console.log("[Parent] Client connected, sending socket to child...");

    // Send the socket to the child
    child.send("socket", socket, { keepOpen: true }, err => {
      if (err) {
        console.error("[Parent] Error sending socket:", err);
      } else {
        console.log("[Parent] Socket sent successfully");
      }
    });
  });

  server.listen(0, () => {
    const port = server.address().port;
    console.log("[Parent] Server listening on port:", port);

    // Connect to the server
    const client = net.connect(port, "127.0.0.1");
    client.on("connect", () => {
      console.log("[Parent] Connected to server");
    });

    client.on("data", data => {
      console.log("[Parent] Received data:", data.toString());
      server.close();
      child.disconnect();
    });
  });
} else {
  // Child process
  console.log("[Child] Started");

  process.on("message", (msg, socket) => {
    console.log("[Child] Received message:", msg);
    console.log("[Child] Socket:", socket);
    console.log("[Child] Socket type:", socket?.constructor?.name);

    if (msg === "socket" && socket) {
      try {
        socket.write("Hello from child!", () => {
          console.log("[Child] Data written to socket");
          process.send("done");
        });
      } catch (err) {
        console.error("[Child] Error writing to socket:", err);
      }
    } else {
      console.error("[Child] Socket is undefined or null!");
    }
  });
}
