// What holds a literal is asked for the literal's own cell; equal texts made at run time are equal all the same.
class Node {
  constructor(color, next) {
    this.color = color;
    this.next = next;
  }
}
const made = ["re" + "d".slice(0), ["bl", "ack"].join(""), "RED".toLowerCase(), "blac" + String.fromCharCode(107), "reds", "", "r", "gréen"];
let list = null;
for (let i = 0; i < 120; i++) list = new Node(i % 4 === 0 ? "red" : i % 4 === 1 ? "black" : i % 4 === 2 ? "gréen" : made[i % made.length], list);
let red = 0, black = 0, green = 0, other = 0, text = "";
for (let round = 0; round < 5; round++)
  for (let node = list; node; node = node.next) {
    if (node.color == "red") red++;
    else if (node.color === "black") {
      black++;
      if (round === 2) node.color = "red";
    } else if (node.color != "gréen") other++;
    else green++;
    if (round === 3 && node.color == "reds") node.color = node.color.slice(0, 3);
  }
for (let node = list; node; node = node.next) text += node.color == "red" ? "r" : node.color == "black" ? "b" : "-";
console.log(red, black, green, other, text);
