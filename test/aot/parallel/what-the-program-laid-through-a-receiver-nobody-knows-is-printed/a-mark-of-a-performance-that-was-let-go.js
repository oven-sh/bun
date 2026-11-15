const kept = JSON.parse("[]");
const box = { v: "text" };
kept.push(performance);
kept.push(box);
kept[1].v = kept[0].mark("a", { startTime: 1 });
console.log(box.v);
console.log("SAID");
