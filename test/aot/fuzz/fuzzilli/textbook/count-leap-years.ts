function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function counted(from: number, to: number): number {
  let count = 0;
  for (let year = from; year <= to; year++) {
    if (isLeap(year)) count++;
  }
  return count;
}
console.log(counted(Number("1896"), Number("2024")), isLeap(1900), isLeap(2000));
