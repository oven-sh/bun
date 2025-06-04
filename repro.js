const tls = require("tls");
const fs = require("fs");

// Create TLS server
const server = tls.createServer(
  {
    key: fs.readFileSync("test/js/node/tls/fixtures/agent1-key.pem"),
    cert: fs.readFileSync("test/js/node/tls/fixtures/agent1-cert.pem"),
  },
  socket => {
    console.log("Server: Client connected");
    socket.write("Hello from server!\n");
  },
);

// Start server
server.listen(0, () => {
  console.log("Server listening on port", server.address().port);
});
const port = server.address().port;

// Create a TLS client connection
const client = tls.connect(
  {
    port,
    rejectUnauthorized: false, // For testing only - don't use in production
  },
  () => {
    console.log("Client connected");
  },
);

let evts = 0;
// Listen for the session event
client.on("session", session => {
  evts += 1;
  if (evts == 2) {
    console.log("Received two sessions, success");
    process.exit(0);
    return;
  }
  console.log("Received TLS session");

  // Store the session for later reuse
  const sessionData = session;

  // Example of reusing the session in a new connection
  const newClient = tls.connect(
    {
      port: 8443,
      rejectUnauthorized: false,
      session: sessionData,
    },
    () => {
      console.log("New client connected with reused session");
    },
  );
});

// Handle errors
client.on("error", err => {
  console.error("TLS connection error:", err);
});

// Handle server errors
server.on("error", err => {
  console.error("Server error:", err);
});

setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 2000);
