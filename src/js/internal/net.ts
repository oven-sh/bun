const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");
const { SocketAddress } = $zig("node_net_binding.zig", "createBinding");

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerHandlers = Symbol.for("::bunsocket_serverhandlers::");
const bunSocketServerConnections = Symbol.for("::bunnetserverconnections::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");

export default {
  addServerName,
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  SocketAddress,
  // symbols
  bunTlsSymbol,
  bunSocketServerHandlers,
  bunSocketServerConnections,
  bunSocketServerOptions,
};
