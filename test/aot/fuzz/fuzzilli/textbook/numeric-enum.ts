enum Day {
  Monday = 1,
  Tuesday,
  Wednesday,
  Saturday = 6,
  Sunday,
}
function kind(day: Day): string {
  switch (day) {
    case Day.Saturday:
    case Day.Sunday:
      return "rest";
    default:
      return "work";
  }
}
console.log(kind(Day.Tuesday), kind(Day.Sunday), Day[2], Day.Wednesday);
