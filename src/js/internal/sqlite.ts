// Shared privately with the native connection setup, including before diagnostics_channel is loaded.
const state: { publisher: ((message: unknown) => void) | undefined } = { publisher: undefined };

export default state;
