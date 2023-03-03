import * as http from "http";

const _server = new http.Server({});
const agent = new http.Agent({});

http.globalAgent;
http.maxHeaderSize;
console.log(Object.getOwnPropertyNames(agent));

const req = http.request({ host: "localhost", port: 3000, method: "GET" });
req.abort;
req.end();
export {};
