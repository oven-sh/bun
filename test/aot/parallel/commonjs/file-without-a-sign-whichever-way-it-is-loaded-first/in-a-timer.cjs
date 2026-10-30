(globalThis.seen ??= []).push(
  "in-a-timer " +
    (function () {
      return typeof this;
    })(),
);
