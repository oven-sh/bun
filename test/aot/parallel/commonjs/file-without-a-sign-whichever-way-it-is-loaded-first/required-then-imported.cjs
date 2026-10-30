(globalThis.seen ??= []).push(
  "required-then-imported " +
    (function () {
      return typeof this;
    })(),
);
