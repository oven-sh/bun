let kept = null;
function keep(o) { for (let k = 0; k < 2; k++) kept = o; }
function make(i) { const list = [i, i + 1, "t" + i]; keep(list); return list.length; }
console.log(make(4), kept.length, kept[0], kept[2], kept.join("-"));
