function clock(seconds: number): string {
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return parts.map(part => String(part).padStart(2, "0")).join(":");
}
console.log(clock(Number("3725")), clock(0), clock(Number("86399")));
