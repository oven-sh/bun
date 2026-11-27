// In a loop, a method of lists whose callback takes a number asks first whether the list holds integers, and goes on over fractions or over anything else where it does not.
const lists: { [name: string]: number[] } = JSON.parse(
  '{"integers":[1,2,3,4,5,6,7,8,9],"fractions":[0.5,1.5,-2.25,4],"both":[1,2,3.5,4],"beyond":[1,2147483647,2147483648,4294967296,9007199254740991],"negative":[-1,-2,-3,0],"none":[]}',
);
lists.zeros = [0, -0, 0];
lists.odd = [NaN, 1, Infinity, -Infinity];
const holes: number[] = [1, 2, 3, 4];
delete holes[2];
lists.holes = holes;
const others: any = JSON.parse('{"nulls":[1,null,3],"texts":[1,"2",3],"objects":[1,{"valueOf":1},3]}');
const log: string[] = [];
function show(value: unknown): string {
  return Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : Object.is(value, -0) ? "-0" : String(value);
}
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(lists)) {
    const list = lists[name];
    log.push(
      [
        name,
        list.filter(n => n % 3 !== 0),
        list.map(n => n * 2 + turn),
        list.map(n => -n),
        list.some(n => n % 7 === turn),
        list.every(n => n > turn - 3),
        list.find(n => n % 2 === 0),
        list.findIndex(n => n > 2 + turn),
        list.reduce((sum, n) => sum + (n & 1023), turn),
        list.reduce((sum, n) => sum + n, 0.5),
      ]
        .map(show)
        .join(" "),
    );
    let seen = 0;
    list.forEach((n, place) => {
      seen += (n & 7) * place;
    });
    log.push(show(seen));
  }
  for (const name of Object.keys(others)) {
    const list: any[] = others[name];
    log.push([name, list.filter((n: number) => n % 3 !== 0), list.map((n: number) => n * 2), list.some((n: number) => n % 7 === 2), list.find((n: number) => n > 2)].map(show).join(" "));
  }
}
// The list changes its kind while the callback goes over it.
for (let turn = 0; turn < 4; turn++) {
  const list = [1, 2, 3, 4, 5, 6];
  const result = list.map((n, place, whole) => {
    if (place === turn) whole[place + 1] = n + 0.5;
    return n * 2;
  });
  log.push(show(result), show(list));
  const texts: any[] = [1, 2, 3, 4, 5, 6];
  const kept = texts.filter((n: number, place, whole) => {
    if (place === turn) whole[place + 1] = "3" + place;
    return n % 3 !== 0;
  });
  log.push(show(kept), show(texts));
  const shrunk = [1, 2, 3, 4, 5, 6];
  let sum = 0;
  shrunk.forEach((n, place, whole) => {
    if (place === turn) whole.length = 4;
    sum += n;
  });
  log.push(show(sum), show(shrunk));
  const grown = [9, 8, 7];
  log.push(
    show(
      grown.some((n, place, whole) => {
        if (place < 2) whole.push(2147483648 + place);
        return n % 5 === 4 + turn;
      }),
    ),
    show(grown),
  );
}
console.log(log.join("\n"));
