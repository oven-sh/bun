(globalThis.seen ??= []).push(
  "while-required " +
    (function () {
      return typeof this;
    })(),
);
