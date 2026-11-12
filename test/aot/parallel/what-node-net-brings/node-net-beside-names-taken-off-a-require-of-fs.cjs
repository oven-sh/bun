// A pattern of names off require("node:fs") leaves the module's object in nobody's hands: node:net goes on calling its functions bare, and the rest of node:fs does not come.
// STATISTIC: ImageFunctionsEmitted <= 1800
const net = require("node:net");
const { fstatSync, existsSync: there } = require("node:fs");
try {
  new net.Socket({ fd: 987, writable: true });
} catch (error) {
  console.log(error.code, typeof fstatSync, there("/"));
}
