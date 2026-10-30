(globalThis.seen ??= []).push(
  "called-later " +
    (function () {
      return typeof this;
    })(),
);
