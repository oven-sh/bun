// The loop carries the element for its bits alone; the next read of the turn takes the number.
function move(turns) {
  const list = [5, 5, 2, 5, 0.5, 5, 5, 5, 5].slice();
  for (let i = 0; i < turns.length; i++) {
    (list[1] < 0) | (list[4] >> 9);
    list[3] = list[4];
    list[4] = (list[5] < 4) | (list[8] > 5);
  }
  return list.join();
}
for (const turns of [[1], [1, 2], []]) console.log(move(turns));

const keep = value => value;
function shift(turns) {
  const words = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5].slice();
  let sum = 0;
  for (let i = 0; i < turns.length; i++) {
    words[0] = (words[1] << 0) | (words[4] >>> 9);
    words[1] = (words[2] << 1) | (words[5] >>> 8);
    words[2] = (words[3] << 2) | (words[6] >>> 7);
    words[3] = keep(words[4]);
    words[4] = (words[5] << 4) | (words[8] >>> 5);
    sum += words[1];
    words[5] = (words[6] << 5) | (words[0] >>> 4);
  }
  return words.join() + " " + sum;
}
for (const turns of [[1], [1, 2, 3], [0.5, 2]]) console.log(shift(turns));
