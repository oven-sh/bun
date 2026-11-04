class E extends Error { get kind() { return "mine"; } }
class M extends Map {}
class L extends Array {}
export const read = () => [E, M, L];
