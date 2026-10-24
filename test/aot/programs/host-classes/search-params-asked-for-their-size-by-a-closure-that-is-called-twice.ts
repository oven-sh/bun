// `new URLSearchParams(text)` is only asked for its size and its text, by a closure that is called twice.
// STATISTIC: URLsLeftUnbuilt >= 1
function readInClosure(text: any) {
  const query = new URLSearchParams(text);
  const ask = () => query.size + query.toString();
  return ask() + ask();
}
for (const text of ["", "a=1", "a=1&b=2", "?a=1&a=2&a=3", "a=%20&b", undefined]) console.log(readInClosure(text));
