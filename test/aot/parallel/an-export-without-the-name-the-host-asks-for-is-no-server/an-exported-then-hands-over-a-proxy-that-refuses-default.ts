// An exported `then` is called with a function that looks for the server in what it is handed. A Proxy that throws at `default`, which it does not have, holds no server, and `then` goes on.
export function then(start: (namespace: unknown) => void) {
  start(
    new Proxy(
      {},
      {
        get(target, name) {
          console.log("refused", String(name));
          throw new Error("read of " + String(name));
        },
      },
    ),
  );
  console.log("then goes on");
}
console.log("ran");
