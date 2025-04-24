const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket, getBufferedAmount] = $zig(
  "socket.zig",
  "createNodeTLSBinding",
);
const { SocketAddress } = $zig("node_net_binding.zig", "createBinding");

export default {
  addServerName,
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  getBufferedAmount,
  SocketAddress,
  normalizedArgsSymbol: Symbol("normalizedArgs"),
};
