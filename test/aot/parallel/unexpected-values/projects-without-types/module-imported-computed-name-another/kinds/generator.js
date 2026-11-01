export default function () {
  return (function* () {
    yield 3;
    yield 1;
    yield 2;
  })();
}
