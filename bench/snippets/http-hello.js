var i = 0;
export default {
  port: 3002,
  fetch(req) {
    if (i++ === 200_000 - 1) setTimeout(() => process.exit(0), 0);
    return new Response("Hello, World!" + i);
  },
};
