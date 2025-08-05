const tls = require("tls");
const https = require("https");

console.log("=== TLS Server ===");
const tlsServer = tls.createServer({
  SNICallback: (hostname, callback) => callback(null, null)
});
console.log("SNICallback type:", typeof tlsServer.SNICallback);
console.log("SNICallback defined:", tlsServer.SNICallback !== undefined);

console.log("\n=== HTTPS Server ===");
const httpsServer = https.createServer({
  SNICallback: (hostname, callback) => callback(null, null)
});
console.log("SNICallback type:", typeof httpsServer.SNICallback);
console.log("SNICallback defined:", httpsServer.SNICallback !== undefined);
console.log("Server constructor:", httpsServer.constructor.name);

// Check if the servers are the same type
console.log("\n=== Comparison ===");
console.log("Same constructor:", tlsServer.constructor === httpsServer.constructor);
console.log("TLS constructor:", tlsServer.constructor.name);
console.log("HTTPS constructor:", httpsServer.constructor.name);

tlsServer.close();
httpsServer.close();