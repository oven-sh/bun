const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.json();
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1, subject instanceof Response);
console.log(Object.keys(subject).join());
