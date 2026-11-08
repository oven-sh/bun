function makeReader() {
  let reads = 0;
  const source = { get value() { reads = reads + 1; return reads * 10; } };
  function fetch() { return source.value; }
  function run() {
    const before = reads;
    const got = fetch();
    return before + " " + got + " " + reads;
  }
  return run;
}
const read = makeReader();
console.log(read(), read(), read());
