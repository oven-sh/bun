const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Response("")).constructor.extra = 41;
function read() {
  return Response.extra;
}
console.log(read());
