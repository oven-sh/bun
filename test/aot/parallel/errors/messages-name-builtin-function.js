// Each row writes `new` in front of a built-in function that cannot be constructed, without arguments, and prints the message of the error: it quotes the callee as it is written.
const S = Symbol;
const B = BigInt;
const holder = { symbol: Symbol, big: BigInt };
function row(run) {
  try {
    run();
    console.log("no error");
  } catch (error) {
    console.log(error.constructor.name + ":", error.message);
  }
}
function inFunction() {
  return new Symbol();
}
function ofParameter(given) {
  return new given.symbol();
}
row(() => new Symbol());
row(() => new BigInt());
row(() => new S());
row(() => new B());
row(() => new globalThis.Symbol());
row(() => new globalThis.BigInt());
row(() => new holder.symbol());
row(() => new holder.big());
row(() => new Math.max());
row(() => new parseInt());
row(() => new Symbol.for());
row(inFunction);
row(() => ofParameter(holder));
row(() => ofParameter(JSON.parse("{}")));
row(() => [1].forEach(() => new Symbol()));
row(() => [2, 1].sort(() => new BigInt()));
row(
  () =>
    new Error("outer", {
      get cause() {
        return new S();
      },
    }),
);
row(
  () =>
    new Map({
      [Symbol.iterator]() {
        return new B();
      },
    }),
);
row(() => new Map(5));
row(() => new Set({ [Symbol.iterator]: 5 }));
row(() => new WeakRef(5));
