const told = list => Array.from(list, x => String(x)).join();
function reversed(list) { let low = 0, high = list.length - 1; while (low < high) { [list[low], list[high]] = [list[high], list[low]]; low++; high--; } return list; }
function turned(list) { for (let a = 0; a < list.length - 1; a++) { const b = a + 1; [list[a], list[b]] = [list[b], list[a]]; } return list; }
function sorted(list) { for (let j = 1; j < list.length; j++) for (let a = j - 1; a >= 0; a--) { const b = a + 1; if (list[a] > list[b]) [list[a], list[b]] = [list[b], list[a]]; } return list; }
class Holder { constructor(list) { this.list = list; } turn() { const list = this.list; for (let a = 0; a < list.length - 1; a++) { const b = a + 1; [list[a], list[b]] = [list[b], list[a]]; } return list; } }
function shuffled(list) { let seed = 7; for (let a = list.length - 1; a > 0; a--) { seed = (seed * 31 + 11) % 1009; const b = seed % (a + 1); [list[a], list[b]] = [list[b], list[a]]; } return list; }
let text = "";
for (let t = 0; t < 8; t++) {
  text += told(reversed([5, 3, 9, 1, 7, t])) + "|" + told(turned([5, 3, 9, 1, 7, t])) + "|" + told(sorted([5, 3, 9, 1, 7, t])) + "|" + told(new Holder([5, 3, 9, 1, 7, t]).turn()) + "|" + told(shuffled([5, 3, 9, 1, 7, t])) + "\n";
  const pushed = [];
  for (let k = 0; k < 14; k++) pushed.push((k * 5 + t) % 14);
  text += told(reversed(pushed)) + "|" + told(sorted(pushed)) + "\n";
}
console.log(text);
