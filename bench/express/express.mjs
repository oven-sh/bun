// See the README.md for more information
import express from "express";

const app = express();
const port = process.env.PORT || 3000;
let i = 0;

app.get("/", (req, res) => {
  res.send("Hello World! (request number: " + i++ + ")");
});

app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
});
