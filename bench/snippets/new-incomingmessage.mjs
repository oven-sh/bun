import { IncomingMessage } from "node:http";
import { bench, run } from "./runner.mjs";

const headers = {
  date: "Mon, 06 Nov 2023 05:12:49 GMT",
  expires: "-1",
  "cache-control": "private, max-age=0",
  "content-type": "text/html; charset=ISO-8859-1",
  "content-security-policy-report-only":
    "object-src 'none';base-uri 'self';script-src 'nonce-lcrU7l9xScCq4urW13K9gw' 'strict-dynamic' 'report-sample' 'unsafe-eval' 'unsafe-inline' https: http:;report-uri https://csp.withgoogle.com/csp/gws/other-hp",
  "x-xss-protection": "0",
  "x-frame-options": "SAMEORIGIN",
  "accept-ranges": "none",
  vary: "Accept-Encoding",
  "transfer-encoding": "chunked",
  "set-cookie": [
    "1P_JAR=2023-11-06-05; expires=Wed, 06-Dec-2023 05:12:49 GMT; path=/; domain=.google.com; Secure",
    "AEC=Ackid1TiuGtRsmu1yaDCAdL1u1J4eM4S67simzDHfWaMPQzH-UB4DZkRwm8; expires=Sat, 04-May-2024 05:12:49 GMT; path=/; domain=.google.com; Secure; HttpOnly; SameSite=lax",
    "NID=511=jQcg9cM7vjKawWnf6f3qhs3WDIIN2gaRq3i4bdMiVRWFkaFNYmiI-Xquf1kAmWGcmDN0skldS7uHheru3CMJrWjMt56VaaqO6Pilb54jFjQS_ZJRfG3Uc7dGV5WXGV-slUGE1Bicxlajdn0E_R8tZOoWiFzFDQW7YGmyfRqWQ2k; expires=Tue, 07-May-2024 05:12:49 GMT; path=/; domain=.google.com; HttpOnly",
  ],
  p3p: 'CP="This is not a P3P policy! See g.co/p3phelp for more info."',
  server: "gws",
  "alt-svc": 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
};

const request = new Request("https://www.google.com/", {
  headers: new Headers(headers),
  method: "GET",
});

// const server = Bun.serve({
//   port: 8080,
//   async fetch(request) {
//     // bench("new IncomingMessage()", b => {
//     //   for (let i = 0; i < 1000; i++) {
//     //     new IncomingMessage(request);
//     //   }
//     // });
//     const msg = new IncomingMessage(request);
//     console.log(msg.headers, msg.rawHeaders, msg.url);
//     // await run();
//     return new Response("Hello, world!");
//   },
// });

bench("new IncomingMessage()", b => {
  for (let i = 0; i < 1000; i++) {
    new IncomingMessage(request);
  }
});

await run();
