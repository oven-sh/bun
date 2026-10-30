// A switch over a sparse enum gets numbers that wrap around to a member.
enum Code {
  Low = -5,
  Zero = 0,
  Mid = 1000,
  Top = 2147483647,
  Bottom = -2147483648,
}
function nameOf(code: Code): string {
  switch (code) {
    case Code.Low:
      return "low";
    case Code.Zero:
      return "zero";
    case Code.Mid:
      return "mid";
    case Code.Top:
      return "top";
    case Code.Bottom:
      return "bottom";
  }
}
const numbers: number[] = [-5, 0, 1000, 2147483647, -2147483648, 2147483648, -2147483649, 4294967291, 4294967296, 4294968296, -5.5, 999.9999999999999, -0, NaN];
for (const n of numbers) console.log(n, nameOf(n), Code[n]);
