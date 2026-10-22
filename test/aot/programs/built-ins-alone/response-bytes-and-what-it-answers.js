const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.bytes();
const settled = await result;
console.log(settled instanceof Uint8Array, settled.length, typeof settled[0], settled[0] + 1);
console.log(typeof settled[1], settled[1] + 1, subject instanceof Response, Object.keys(subject).join());
