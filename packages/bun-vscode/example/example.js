// @bun
const express = import.meta.require("express");
const app = express();

app
  .get("/", (req, res) => {
    new Promise((resolve, reject) => {
      setTimeout(() => resolve(), 1);
    }).then(() => {
      debugger;
    });
    res.send("hello world");
  })
  .listen(3000);

const va = 1;
let vb = 2;
var vc = 3;

setInterval(() => {
  debugger;
}, 10);

function fa() {
  fb();
}

function fb() {
  fc();
}

function fc() {
  fd();
}

function fd() {
  let map = new Map([
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
  let set = new Set([1, 2, 3, 4, 5]);
  let arr = [1, 2, 3, 4, 5];
  let obj = {
    a: 1,
    b: 2,
    c: 3,
  };
  function fd1() {
    let date = new Date();
    console.log(new Error().stack);
    debugger;
    console.log(date);
  }
  fd1();
}

Bun.serve({
  port: 9229,
  inspector: true,
  development: true,
  fetch(request, server) {
    console.log(request);
    return new Response(request.url);
  },
});
