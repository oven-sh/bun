// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: FunctionsLowered <= 1100

// Little more than a program that fetches.

// FILE: main.js
const server = Bun.serve({ port: 0, fetch: request => new Response("hello " + new URL(request.url).pathname) });
const response = await fetch(new URL("/a", server.url));
console.log(response.status, await response.text());
await server.stop(true);
