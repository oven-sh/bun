const bunFetch = Bun.fetch;
const fetch = (...args) => bunFetch(...args);
fetch.default = fetch;
fetch.fetch = fetch;
export default fetch;
