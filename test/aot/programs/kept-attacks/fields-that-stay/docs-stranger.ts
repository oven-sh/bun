// Fields that stay: docs stranger. It prints what plain Bun prints.
interface Config {
  host: string;
  port: number;
}
class Server {
  config: Config = { host: "localhost", port: 80 };
}

const server = new Server();
server.config = JSON.parse('{"host":"example.com","port":"8080"}');
console.log(server.config.host, server.config.port);
try {
  (server as any).config = "example.com:8080";
} catch (error) {
  console.log(String(error));
}
