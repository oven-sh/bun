// tee() answers a new list of two new streams, and a chunk that is an object is the same object in both.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const crate = { weight: 1 };
const source = known({
  start(controller) {
    controller.enqueue(crate);
    controller.close();
  },
});
const branches = source.tee();
const left = (await branches[0].getReader().read()).value;
left.weight += 1;
const right = (await branches[1].getReader().read()).value;
console.log(Array.isArray(branches), branches.length, branches[0] === branches[1], branches[0] === source, left === right, right.weight, source.locked);
