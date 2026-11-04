// a generator loops over a generator that its loop alone has and yields in each turn, and is dropped, returned from and thrown into in the middle
function* inner(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { console.log("inner closed"); } }
function* outer(limit, scale) { let total = 0; try { for (const value of inner(limit)) { total += value; yield value * scale + total; } } finally { console.log("outer closed " + total); } return total; }
function text(result) { return result.done + ":" + result.value; }
function deed(how) { const running = outer(4, 10); let all = text(running.next()) + " " + text(running.next()); try { if (how === "return") all += " " + text(running.return(7)); if (how === "throw") all += " " + text(running.throw(new RangeError("sent"))); } catch (error) { all += " " + error.name; } return all + " " + text(running.next()); }
console.log(deed("on"));
console.log(deed("return"));
console.log(deed("throw"));
for (let i = 0; i < 3; i++) console.log(deed("return"));
