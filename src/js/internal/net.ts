const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");
const { SocketAddress, AF_INET, AF_INET6 } = $zig("node_net_binding.zig", "createNodeNetBinding");

export default { addServerName, upgradeDuplexToTLS, isNamedPipeSocket, SocketAddress, AF_INET, AF_INET6 };
