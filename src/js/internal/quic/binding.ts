// Bun's equivalent of Node's `internalBinding('quic')`.
export default $rust("node_quic_binding.rs", "createNodeQuicBinding");
