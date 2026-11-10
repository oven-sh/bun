function read(list: Map<string, number[]>): string {
  let text = list.size + ":";
  for (const [key, value] of list) text += key + value.join();
  return text;
}
console.log(read(new Map([["x", [0]]])));
console.log(read(Map.groupBy([1, 2, 3], x => (x & 1 ? "odd" : "even"))));
