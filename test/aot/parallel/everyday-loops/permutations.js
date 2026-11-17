// Permutations by swaps in a recursion with loops
function permute(list) {
  const out = [];
  let calls = 0;
  (function go(n) {
    calls++;
    if (n === list.length) {
      out.push(list.join(""));
      return;
    }
    for (let i = n; i < list.length; i++) {
      [list[n], list[i]] = [list[i], list[n]];
      go(n + 1);
      [list[n], list[i]] = [list[i], list[n]];
      if (out.length >= 10) break;
    }
  })(0);
  return out.join(" ") + " " + calls + " " + list.join("");
}
console.log(permute([1, 2, 3]));
console.log(permute(["a", "b", "c", "d"]));
console.log(permute([]), permute([0.5, null]));
