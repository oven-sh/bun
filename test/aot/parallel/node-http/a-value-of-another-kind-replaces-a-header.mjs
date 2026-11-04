// A response keeps its headers in a form of its own until somebody looks. setHeader() asks whether validation is lenient in the middle of a store into that form, under a symbol that has a preparation:
// when that one access went by value, it gave the form up, and the value of another kind went into what had just been given up: the old text stayed.
import http from "node:http";
const ways = [
  r => { r.setHeader("x-a", "café"); r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", "cafe"); r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", "café"); r.removeHeader("x-b"); r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", "cafe"); r.removeHeader("x-b"); r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", "café"); r.setHeader("x-a", "plain"); },
  r => { r.setHeader("x-a", "café"); r.setHeader("x-a", 5); },
  r => { r.setHeader("x-a", "café"); r.setHeader("x-a", ["l"]); },
  r => { r.setHeader("x-0", "v"); r.setHeader("x-a", "café"); r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", true); },
  r => { r.setHeader("x-a", "é"); r.setHeader("x-b", "é"); r.setHeader("x-b", true); r.setHeader("x-a", null === 1); },
];
const server = http.createServer((request, response) => {
  ways[Number(request.url.slice(1))](response);
  console.log(request.url, JSON.stringify(response.getHeaders()));
  response.end("ok");
});
server.listen(0, async () => {
  for (let way = 0; way < ways.length; way++) await (await fetch("http://localhost:" + server.address().port + "/" + way)).text();
  server.close();
});
