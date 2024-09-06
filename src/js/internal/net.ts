const [addServerName, upgradeDuplexToTLS] = $zig("socket.zig", "createNodeTLSBinding");

export default { addServerName, upgradeDuplexToTLS };
