// The native fetch, not the user-replaceable `Bun.fetch` or `globalThis.fetch`.
const bunFetch: typeof globalThis.fetch = $cpp("NodeFetch.cpp", "createNodeFetchInternalBinding")[6];
const fetch = (...args: Parameters<typeof bunFetch>) => bunFetch(...args);
fetch.default = fetch;
fetch.fetch = fetch;
export default fetch;
