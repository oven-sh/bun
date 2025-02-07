const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");
const { SocketAddressNew } = $zig("node_net_binding.zig", "createBinding");

export default { addServerName, upgradeDuplexToTLS, isNamedPipeSocket, SocketAddressNew };
