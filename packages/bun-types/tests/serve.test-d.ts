const server = Bun.serve({
  fetch(req) {
    console.log(req.url); // => http://localhost:3000/
    return new Response("Hello World");
  },
  keyFile: "ca.pem",
  certFile: "cert.pem",
});

// Bun.serve({});

export {};
