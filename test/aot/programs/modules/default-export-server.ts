// An entry module whose default export is a server configuration starts that server after it is evaluated.
console.debug = (message: unknown) => console.log("debug " + String(message).replace(/:\d+$/, ":PORT"));
setTimeout(() => process.exit(0), 50);
export default { port: 0, fetch() { return new Response("ok"); } };
