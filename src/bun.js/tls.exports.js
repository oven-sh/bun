import net from "node:net";

class Server extends net.Server {

}

export function createServer(options, callback) {
  return new Server(options, callback);
}

export default {
  createServer,
  Server
};