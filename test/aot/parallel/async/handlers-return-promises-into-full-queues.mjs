// A handler of a promise ends in a call that returns a settled promise while the queue of jobs has no room left: the run time makes the promise and queues its job.
// Each handler queues one job more, so that the queue grows where a handler returns. It keeps its room, so the sizes rise.
let order = 0;
const out = [];
const ended = async value => value;
const queue = i => {
  Promise.resolve(i).then(value => {
    order = (order * 43 + value) | 0;
  });
};
const settle = i => value => {
  order = (order * 31 + i) | 0;
  return value;
};
const kinds = [
  i => Promise.resolve(i).then(() => { queue(i); return Promise.resolve(i); }).then(settle(i)),
  i => Promise.resolve(i).then(() => { queue(i); return ended(i); }).then(settle(i)),
  i => Promise.resolve(i).then(() => { queue(i); return Promise.resolve(); }).then(settle(i)),
];

let size = 5;
for (let turn = 0; turn < 24; turn++) {
  const kind = kinds[turn % kinds.length];
  order = 0;
  const all = [];
  for (let i = 0; i < size; i++) all.push(kind(i));
  const values = await Promise.all(all);
  out.push(`${size} ${turn % kinds.length} ${order} ${values.filter(value => value !== undefined).length}`);
  size = Math.ceil(size * 1.4);
}
for (const line of out) console.log(line);
