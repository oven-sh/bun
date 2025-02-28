import express from "express";

const app = express();
const port = 3000;

var i = 0;
app.get("/", (req, res) => {
  res.send("Hello World!" + i++);
});

app.listen(port, () => {
  console.log(`Express app listening at http://localhost:${port}`);
});
