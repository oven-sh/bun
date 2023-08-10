// @bun
const va = 1;
let vb = 2;
var vc = 3;

setInterval(() => {
  fa();
}, 3000);

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
    console.log(date);
    debugger;
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
