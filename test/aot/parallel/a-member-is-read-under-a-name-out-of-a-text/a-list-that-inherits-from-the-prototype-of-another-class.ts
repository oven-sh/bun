const names: any[] = JSON.parse('["union","isSubsetOf","has","map","size"]');
for (const name of names) {
  const list: any = [1, 2];
  Object.setPrototypeOf(list, Set.prototype);
  let read: any;
  try {
    read = list[name];
  } catch {
    read = "threw";
  }
  console.log(name, typeof read);
  if (name === "union") console.log([...read.call(new Set([1]), new Set([2]))].join());
  if (name === "isSubsetOf") console.log(read.call(new Set([1]), new Set([1, 2])));
  if (name === "has") console.log(read.call(new Set([1]), 1));
}
const steps: any = [1, 2];
Object.setPrototypeOf(steps, Iterator.prototype);
for (const name of JSON.parse('["take","toArray","drop","flatMap"]')) {
  const read = steps[name];
  console.log(
    name,
    typeof read,
    name === "toArray"
      ? read.call([5, 6].values()).join()
      : name === "flatMap"
        ? typeof read
        : [...read.call([5, 6, 7].values(), 1)].join(),
  );
}
