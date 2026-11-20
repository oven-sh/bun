let K;
do {
  K = Symbol("k");
} while (false);
const unseen = (x) => [x][JSON.parse("0")];
const holder = {};
holder[K] = 1;
console.log(holder[unseen(K)], unseen(K) === K, unseen(holder)[K], Reflect.ownKeys(holder)[0] === unseen(K));
