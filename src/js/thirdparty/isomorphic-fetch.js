const bunFetch = Bun.fetch;
const fetch = (...args) => bunFetch(...args);
fetch.default = wrapper;
fetch.fetch = wrapper;
export default fetch;
