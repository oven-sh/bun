const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.bodyUsed;
console.log(typeof result, result);
