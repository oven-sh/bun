// Bun's equivalent of Node's `internalBinding('quic')`.
export default $bindgen("node_quic_binding.bind.ts", "binding") as $Node.QuicBinding;
