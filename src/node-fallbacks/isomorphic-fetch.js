var fetchHandler = globalThis.fetch;

if ("Bun" in globalThis) {
  fetchHandler = Bun.fetch;
}

export default fetchHandler;
export { fetchHandler as fetch };
