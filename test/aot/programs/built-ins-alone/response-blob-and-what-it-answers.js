const subject = new Response("[1.5]", { status: 201, headers: { first: "1" } });
const result = subject.blob();
const settled = await result;
console.log(settled instanceof Blob, Object.keys(settled).join(), subject instanceof Response, Object.keys(subject).join());
