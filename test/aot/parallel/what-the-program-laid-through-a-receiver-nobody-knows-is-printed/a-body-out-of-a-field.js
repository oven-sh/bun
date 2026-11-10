const kept = JSON.parse("[]");
const box = { v: "text" };
kept.push(new Response("a"));
kept.push(box);
kept[1].v = kept[0].body;
console.log(box.v);
console.log("SAID");
