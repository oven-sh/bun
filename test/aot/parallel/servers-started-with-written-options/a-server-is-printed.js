// The formatter runs every getter of native code above the server: `url` makes a URL, which the host prints by util.inspect. Nothing else in the program brings that in.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {} });
const printed = Bun.inspect(server);
console.log(printed.includes("url: URL {"), printed.includes("searchParams: URLSearchParams {"), printed.includes("pendingRequests: 0"));
process.exit(0);
