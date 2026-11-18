// Beside the options that Bun.serve knows lies an object that is copied under keys made at run time. A read under such a key may find what every object inherits. Bun.serve iterates where its options hold a sequence and nowhere else, and its messages print no value.
// STATISTIC: ImageFunctionsEmitted <= 80
const store = { A: "x" };
const copy = {};
for (const name of JSON.parse('["a"]')) copy[name] = store[name.toUpperCase()];
const server = Bun.serve({ port: 0, fetch: () => new Response("x"), settings: copy });
console.log(typeof server.port);
server.stop(true);
