import { file, serve } from "bun";
import { expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

var port = 60000;

it("should work for a hello world", async () => {
  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(`Hello, world!`);
    },
  });
  const response = await fetch(`http://localhost:${server.port}`);
  expect(await response.text()).toBe("Hello, world!");
  server.stop();
});

it("should work for a file", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(file(fixture));
    },
  });
  const response = await fetch(`http://localhost:${server.port}`);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

// var count = 200;
// it(`should work for a file ${count} times`, async () => {
//   const fixture = resolve(import.meta.dir, "./fetch.js.txt");
//   const textToExpect = readFileSync(fixture, "utf-8");
//   var ran = 0;
//   const server = serve({
//     port: port++,
//     async fetch(req) {
//       console.log(`Ran ${ran++}`);
//       return new Response(file(fixture));
//     },
//   });

//   for (let i = 0; i < count; i++) {
//     const response = await fetch(`http://localhost:${server.port}`);
//     expect(await response.text()).toBe(textToExpect);
//   }

//   server.stop();
// });
