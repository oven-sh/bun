(globalThis.seen ??= []).push(
  "in-a-callback " +
    (function () {
      return typeof this;
    })(),
);
