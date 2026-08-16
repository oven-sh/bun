var i = 0;
export default {
  fetch(req) {
    if (i++ === 1_000_000 - 1) setTimeout(() => process.exit(0), 1);
    return new Response("Hello, World!" + i);
  },
};
