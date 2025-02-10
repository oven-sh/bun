const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");
const { SocketAddressNative, AF_INET, AF_INET6 } = $zig("node_net_binding.zig", "createBinding");

export default { addServerName, upgradeDuplexToTLS, isNamedPipeSocket, SocketAddressNative, AF_INET, AF_INET6 };
