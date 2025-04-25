// This is just a no-op. Intent is to prevent importing a bunch of stuff that isn't relevant.
export default (wrapper = Bun.fetch) => {
  async function vercelFetch(url, opts = {}) {
    // Convert Object bodies to JSON if they are JS objects
    if (
      opts.body &&
      typeof opts.body === "object" &&
      (!("buffer" in opts.body) || typeof opts.body.buffer !== "object" || !(opts.body.buffer instanceof ArrayBuffer))
    ) {
      opts.body = JSON.stringify(opts.body);
      // Content length will automatically be set
      if (!opts.headers) opts.headers = new Headers();

      opts.headers.set("Content-Type", "application/json");
    }

    try {
      return await wrapper(url, opts);
    } catch (error) {
      error.url = url;
      error.opts = opts;
      throw error;
    }
  }

  vercelFetch.default = vercelFetch;
  return vercelFetch;
};
