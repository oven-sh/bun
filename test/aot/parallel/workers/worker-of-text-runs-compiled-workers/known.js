// A compiled Worker: it answers each number with work that needs the tables of its program.
class Point {
  constructor(x) {
    this.x = x;
    this.name = "p" + x;
  }
  get double() {
    return this.x * 2;
  }
}
const work = (n) => {
  const table = {};
  for (let i = 0; i < 20; i++) table["key" + ((n + i) % 7)] = new Point(i);
  let caught = "";
  try {
    null.missing;
  } catch (error) {
    caught =
      error.stack.split("\n").length > 1 ? error.constructor.name : "no stack";
  }
  return (
    Object.keys(table).sort().join("").length +
    JSON.stringify(new Point(n)).length +
    /p(\d+)/.exec(new Point(n).name)[1].length +
    caught.length +
    new Point(n).double
  );
};
self.onmessage = (event) => {
  if (event.data !== "start text") return postMessage(work(event.data));
  const inner = new Worker(
    "data:text/javascript,postMessage('text below a compiled Worker: ' + eval('6 * 7'))",
  );
  inner.onmessage = (event) => (inner.terminate(), postMessage(event.data));
  inner.onerror = (event) =>
    postMessage("error: " + event.message.slice(0, 60));
};
