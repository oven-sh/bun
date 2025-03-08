const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");
const { SocketAddress } = $zig("node_net_binding.zig", "createBinding");

export default {
  addServerName,
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  SocketAddress,
  normalizedArgsSymbol: Symbol("normalizedArgs"),
};
