const bunFetch = Bun.fetch;
const fetch = (...args: Parameters<typeof bunFetch>) => bunFetch(...args);
fetch.default = fetch;
fetch.fetch = fetch;
export default fetch;
