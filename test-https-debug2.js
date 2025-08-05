const tls = require("tls");
const https = require("https");

const options = {
  SNICallback: (hostname, callback) => {
    console.log("SNI callback called with:", hostname);
    callback(null, null);
  }
};

console.log("Creating HTTPS server with options:", Object.keys(options));

// Test direct TLS server creation
console.log("\n=== Direct TLS Server ===");
const directTls = tls.createServer(options);
console.log("Direct TLS SNICallback:", typeof directTls.SNICallback);

// Test HTTPS server creation (should route to TLS)
console.log("\n=== HTTPS Server (should route to TLS) ===");
const httpsServer = https.createServer(options);
console.log("HTTPS SNICallback:", typeof httpsServer.SNICallback);

// Check if they're actually the same type
console.log("\n=== Type comparison ===");
console.log("Direct TLS instanceof:", directTls.constructor.name);
console.log("HTTPS instanceof:", httpsServer.constructor.name);
console.log("Are same constructor:", directTls.constructor === httpsServer.constructor);

directTls.close();
httpsServer.close();