const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.body;
console.log(result instanceof ReadableStream, Object.keys(result).join(), subject instanceof Response, Object.keys(subject).join());
