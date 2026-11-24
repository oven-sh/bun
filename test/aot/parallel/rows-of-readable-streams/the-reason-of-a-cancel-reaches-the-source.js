// cancel(reason) of the stream, of its reader, and return() of its iterator hand the source what they were handed.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
function made(log) {
  return known({
    cancel(reason) {
      if (reason) reason.seen = (reason.seen ?? 0) + 1;
      log.push(reason);
    },
  });
}
const log = [];
const one = { name: "one" };
const two = { name: "two" };
const three = { name: "three" };
console.log(await made(log).cancel(one), one.seen);
console.log(await made(log).getReader().cancel(two), two.seen);
const ended = await made(log).values().return(three);
console.log(ended.value === three, ended.done, three.seen, log[0] === one, log[1] === two, log[2] === three, log.length);
