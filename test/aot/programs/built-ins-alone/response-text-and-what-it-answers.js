const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.text();
const settled = await result;
console.log(typeof settled, settled.length, settled, subject instanceof Response, Object.keys(subject).join());
