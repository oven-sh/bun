// The native node:quic binding object — Bun's equivalent of Node's
// `internalBinding('quic')`. A single shared instance is required because
// `setCallbacks()` may only be invoked once and the constants/Endpoint
// constructor must be identical across the internal quic modules.
export default $rust("node_quic_binding.rs", "createNodeQuicBinding");
