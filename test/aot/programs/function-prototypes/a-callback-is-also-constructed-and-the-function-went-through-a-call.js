// A plain function is a listener, the callback of an array method and of a timer, and it is constructed too. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const seen = [];
const count = hide(function count(item) { seen.push(new.target === undefined ? "called" : "constructed", typeof item, this === undefined || this === globalThis ? "none" : typeof this); });
[1].forEach(count);
new count("s");
count.prototype.more = function () { return "more"; };
setTimeout(count, 0, null);
setTimeout(() => console.log(seen.join(), new count().more()), 5);
