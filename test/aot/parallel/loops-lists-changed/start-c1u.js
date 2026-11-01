// A do-while walks a list downward from a start that may be -1: there is no element there, and the read says undefined. The start comes from findIndex.
function walk(list, from, stop) {

  let u = 0, d = 0, turns = 0, i = list.findIndex((v) => v === from);
  do {
    if (list[i] === undefined) u++; else d++;
    if (i === -1 || i === 0) break;
    i--;
  } while (i > stop);
  return u * 1000 + d + (i === i ? 0 : 1);
}
const list = []; for (let k = 0; k < 32; k++) list.push(k + 1);
{
const all = [];
{ const from = 0;
all.push(walk(list, from, 1));
}
{ const from = 1;
all.push(walk(list, from, 1));
}
{ const from = 2;
all.push(walk(list, from, 1));
}
{ const from = 3;
all.push(walk(list, from, 1));
}
console.log(all.join());
}
