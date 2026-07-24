const express = require("express");
const { makeCache, handle } = require("./shared.js");
const app = express();
const cache = makeCache();
app.get("/api/:id", (req, res) => {
  res.json(handle(cache, req.params.id, req.query));
});
const server = app.listen(0, () => {
  process.stderr.write(`LISTEN ${server.address().port}\n`);
});
