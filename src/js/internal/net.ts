const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket] = $zig("socket.zig", "createNodeTLSBinding");

export default { addServerName, upgradeDuplexToTLS, isNamedPipeSocket };
