// A number is sought in long lists of fractions and of whole numbers.
function seek(count: number, sought: number): string {
  const fractions: number[] = [], whole: number[] = [];
  for (let index = 0; index < count; index++) {
    fractions.push(index + 0.5);
    whole.push(index);
  }
  fractions[count >> 1] = -0;
  return [fractions.indexOf(sought), fractions.includes(sought), whole.indexOf(sought), whole.includes(sought)].join();
}
for (let turn = 0; turn < 6; turn++) console.log(seek(300, turn * 59 + 0.5), seek(300, turn * 59), seek(4, turn + 0.5), seek(300, turn / 0), seek(300, turn * 0), seek(300, 0 / turn));
