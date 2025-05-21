const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const packageDefinition = protoLoader.loadSync("benchmark.proto", {});
const proto = grpc.loadPackageDefinition(packageDefinition).benchmark;
const fs = require("fs");

function ping(call, callback) {
  callback(null, { message: "Hello, World" });
}

function main() {
  const server = new grpc.Server();
  server.addService(proto.BenchmarkService.service, { ping: ping });
  const tls = !!process.env.TLS && (process.env.TLS === "1" || process.env.TLS === "true");
  const port = process.env.PORT || 50051;
  const host = process.env.HOST || "localhost";
  let credentials;
  if (tls) {
    const ca = fs.readFileSync("./cert.pem");
    const key = fs.readFileSync("./key.pem");
    const cert = fs.readFileSync("./cert.pem");
    credentials = grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }]);
  } else {
    credentials = grpc.ServerCredentials.createInsecure();
  }
  server.bindAsync(`${host}:${port}`, credentials, () => {
    console.log(`Server running at ${tls ? "https" : "http"}://${host}:${port}`);
  });
}

main();
