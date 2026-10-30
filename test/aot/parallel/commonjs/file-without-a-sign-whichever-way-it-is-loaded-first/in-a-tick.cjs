(globalThis.seen ??= []).push(
  "in-a-tick " +
    (function () {
      return typeof this;
    })(),
);
