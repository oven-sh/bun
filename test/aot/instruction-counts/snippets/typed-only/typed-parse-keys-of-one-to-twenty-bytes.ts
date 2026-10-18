// parses an object whose twenty keys are one to twenty bytes long, in the declared order, with JSON.parse<T>()
interface Keys {
  a: number;
  ab: number;
  abc: number;
  abcd: number;
  abcde: number;
  abcdef: number;
  abcdefg: number;
  abcdefgh: number;
  abcdefghi: number;
  abcdefghij: number;
  abcdefghijk: number;
  abcdefghijkl: number;
  abcdefghijklm: number;
  abcdefghijklmn: number;
  abcdefghijklmno: number;
  abcdefghijklmnop: number;
  abcdefghijklmnopq: number;
  abcdefghijklmnopqr: number;
  abcdefghijklmnopqrs: number;
  abcdefghijklmnopqrst: number;
}
const operations = 10;
const text = JSON.stringify(Object.fromEntries(["a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghij", "abcdefghijk", "abcdefghijkl", "abcdefghijklm", "abcdefghijklmn", "abcdefghijklmno", "abcdefghijklmnop", "abcdefghijklmnopq", "abcdefghijklmnopqr", "abcdefghijklmnopqrs", "abcdefghijklmnopqrst"].map((name, at) => [name, at])));
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const keys = JSON.parse<Keys>(text);
    total += keys.a + keys.abcdefghijklmnopqrst;
  }
}

console.log(total);
