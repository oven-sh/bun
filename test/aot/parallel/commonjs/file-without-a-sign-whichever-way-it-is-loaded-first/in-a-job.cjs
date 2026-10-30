(globalThis.seen ??= []).push(
  "in-a-job " +
    (function () {
      return typeof this;
    })(),
);
