// The headers of a request are copied under keys that are made at run time. A read under such a key may find what every object inherits, functions among them. fetch looks for its one callback on `tls` of the options: it calls nothing that lies among the headers.
// STATISTIC: ImageFunctionsEmitted <= 100
const store = { ACCEPT: "text/plain" };
const list = JSON.parse('["accept"]');
const copy = {};
for (const name of list) copy[name] = store[name.toUpperCase()];
fetch("data:text/plain,answered", { headers: copy }).then(
  response => console.log(response.status),
  () => console.log("failed"),
);
