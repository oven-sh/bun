const kept = JSON.parse("[]");
const box = { v: "text" };
kept.push(URL.parse);
kept.push(box);
kept[1].v = kept[0]("http://made.up/a");
console.log(box.v);
console.log("SAID");
