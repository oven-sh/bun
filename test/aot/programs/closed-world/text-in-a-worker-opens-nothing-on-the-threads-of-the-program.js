// The compiler finds nothing in this program that evaluates text, and counts on it. A Worker that starts from text evaluates what it likes, apart from the program.
// What the threads of the program refuse stays refused before, while and after such a Worker runs.
const hidden = (...parts) => parts.join("");
const attempt = (what, f) =>
  Promise.resolve()
    .then(f)
    .then(
      (value) => console.log(what + ":", value),
      (error) => console.log(what + ": refused", error.name, error.code ?? ""),
    );
const all = async (when) => {
  await attempt(when + " eval", () => globalThis[hidden("ev", "al")]("1 + 1"));
  await attempt(when + " Function", () =>
    globalThis[hidden("Func", "tion")]("return 2")(),
  );
  await attempt(when + " the constructor of a function", () =>
    (() => {})[hidden("const", "ructor")]("return 3")(),
  );
  await attempt(when + " import of text", () =>
    import(hidden("data:text/java", "script,export default 4")).then(
      (loaded) => loaded.default,
    ),
  );
};
await all("before");
const worker = new Worker(
  hidden("data:text/java", "script,onmessage = event => postMessage(eval(event.data))"),
);
const ask = (text) =>
  new Promise((done) => {
    worker.onmessage = (event) => done(event.data);
    worker.onerror = (event) => done("error " + event.message.slice(0, 60));
    worker.postMessage(text);
  });
console.log("the Worker evaluates:", await ask("6 * 7"));
await all("while");
worker.terminate();
await new Promise((done) => worker.addEventListener("close", done));
await all("after");
