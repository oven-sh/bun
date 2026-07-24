const fastify = require("fastify")();
const { makeCache, handle } = require("./shared.js");
const cache = makeCache();
fastify.get("/api/:id", (req, reply) => {
  reply.send(handle(cache, req.params.id, req.query));
});
fastify.listen({ port: 0 }, (err, addr) => {
  if (err) throw err;
  process.stderr.write(`LISTEN ${fastify.server.address().port}\n`);
});
