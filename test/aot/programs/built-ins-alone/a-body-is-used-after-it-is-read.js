const response = new Response("abc");
console.log(response.bodyUsed);
const waiting = response.text();
console.log(response.bodyUsed, (await waiting).length, response.bodyUsed);
