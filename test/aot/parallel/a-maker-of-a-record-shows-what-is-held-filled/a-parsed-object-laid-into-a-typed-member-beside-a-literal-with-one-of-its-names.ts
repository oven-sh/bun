interface Shape { inner: number }
function brief(start: number): number {
  const arrived: Shape = JSON.parse('{"other":1}');
  const link: { value: Shape; count: number } = { value: arrived, count: start };
  return link.count;
}
function other(): void {
  const made: any = { count: 1 };
}
for (let turn = 0; turn < 2; turn++) console.log(brief(turn));
other();
