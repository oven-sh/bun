(globalThis.seen ??= []).push(
  "imported-then-required " +
    (function () {
      return typeof this;
    })(),
);
