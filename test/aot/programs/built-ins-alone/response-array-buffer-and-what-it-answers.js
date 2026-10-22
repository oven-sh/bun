const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.arrayBuffer();
const settled = await result;
console.log(settled instanceof ArrayBuffer, settled.byteLength, subject instanceof Response, Object.keys(subject).join());
