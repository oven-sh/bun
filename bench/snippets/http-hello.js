var i = 0;
export default {
  fetch(req) {
    if (i++ === 200_000 - 1) queueMicrotask(() => process.exit(0));
    return new Response("Hello, World!" + i);
  },
};
