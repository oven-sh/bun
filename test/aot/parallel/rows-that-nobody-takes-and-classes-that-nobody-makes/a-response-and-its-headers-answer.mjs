const answer = new Response("text", { headers: { kind: "plain" } });
console.log(answer.constructor.name, answer.headers.constructor.name, answer.headers.get("kind"), [...answer.headers].length);
console.log(await answer.text());
