// The fetch of a server converts a String object that is the address by calling its own toString.
let calls = 0;
const address = new String("http://localhost/a");
address.toString = () => {
  calls++;
  return "http://localhost/b";
};
const server = Bun.serve({ port: 0, fetch: request => new Response(new URL(request.url).pathname) });
const response = await server.fetch(address);
console.log(await response.text(), calls);
server.stop(true);
