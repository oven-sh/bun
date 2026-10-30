(globalThis.seen ??= []).push(
  "required-while-imported " +
    (function () {
      return typeof this;
    })(),
);
