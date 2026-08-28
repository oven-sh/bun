// See the README.md for more information
import express from "express";

const app = express();
const port = Number(process.env.PORT || 3000);
let i = 0;

app.get("/", (req, res) => {
  res.send("Hello World! (request number: " + i++ + ")");
});

const server = app.listen(port, () => {
  console.log(`Express server listening on port ${server.address().port}`);
});
