// A switch over true, and one over numbers with a block of its own names
function grade(points) {
  let text = "";
  switch (true) {
    case points >= 90:
      text = "A";
      break;
    case points >= 50: {
      const rest = points - 50;
      text = "B" + rest;
      break;
    }
    default:
      text = "C";
  }
  switch (points % 3) {
    case 0:
    case 1: {
      const rest = "low";
      return text + rest;
    }
    case 2:
      return text + "two";
  }
  return text;
}
console.log(grade(95), grade(90));
console.log(grade(52), grade(50));
console.log(grade(0), grade(2));
