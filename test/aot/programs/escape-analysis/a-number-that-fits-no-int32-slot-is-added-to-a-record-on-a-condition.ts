// A record gets an optional number field on a condition. Most values are small integers; some are not. The object is read in place, handed on, listed and serialized.
type Reply = { ok: boolean; error?: string; value?: number };

function inPlace(i: number): number {
  const reply: Reply = { ok: (i & 1) === 0 };
  if (reply.ok) reply.value = i;
  else reply.error = "odd";
  return (reply.value ?? 0) + (reply.error?.length ?? 0);
}

function handedOn(i: number, keep: Reply[]): Reply {
  const reply: Reply = { ok: (i & 1) === 0 };
  if (reply.ok) reply.value = i;
  else reply.error = "odd";
  if (i > 4294967296) keep.push(reply);
  return reply;
}

function twoAdded(i: number, scale: number): string {
  const reply: Reply = { ok: true };
  reply.error = "first";
  reply.value = i * scale;
  return Object.keys(reply).join() + ":" + JSON.stringify(reply) + ":" + ("value" in reply) + ":" + typeof reply.value;
}

function addedThenStoredAgain(i: number, scale: number): number {
  const reply: Reply = { ok: true };
  reply.value = i * scale;
  reply.value = (reply.value ?? 0) + 1;
  return reply.value;
}

function addedThenDeleted(i: number, scale: number): string {
  const reply: Reply = { ok: true };
  reply.value = i * scale;
  delete reply.value;
  reply.error = "later";
  if (i & 1) reply.value = i * scale;
  return Object.keys(reply).join() + ":" + String(reply.value);
}

const numbers = [0, 1, 2, 3, 2147483646, 2147483647, 2147483648, 4294967298, -2147483643, -2147483644, -2147483648, -2147483650, 9007199254740992, 0.5, -0, NaN, Infinity];
const keep: Reply[] = [];
for (let round = 0; round < 3; round++) {
  for (const n of numbers) {
    const reply = handedOn(n, keep);
    console.log(inPlace(n), JSON.stringify(reply), Object.keys(reply).join(), Object.is(reply.value, n), twoAdded(n, 1), twoAdded(n, 1.5), addedThenStoredAgain(n, 2), addedThenDeleted(n, 3));
  }
}
console.log(keep.length, JSON.stringify(keep));
let sum = 0;
for (let i = 2147483000; i < 2147484400; i++) sum += inPlace(i);
console.log(sum);
