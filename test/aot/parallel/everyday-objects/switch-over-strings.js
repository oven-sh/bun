// A switch over strings with cases that fall through and a default in the middle
function cost(words) {
  let sum = 0;
  const seen = [];
  for (const word of words) {
    switch (word) {
      case "add":
        sum += 1;
      case "more":
        sum += 10;
        break;
      default:
        seen.push(word);
      case "reset":
        sum = 0;
        break;
      case "stop":
        return "stopped " + sum + seen.length;
    }
  }
  return sum + " " + seen.join();
}
console.log(cost(["add", "more", "add"]));
console.log(cost(["more", "what", "more", "ad" + "d"]));
console.log(cost(["reset", "more", "stop", "add"]));
