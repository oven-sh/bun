// What is stored into one list of the site shows in no other list of the site.
function make() { return [undefined, null, undefined]; }
const first = make();
first[0] = "first";
first[1] = 1;
first.push("behind");
const second = make();
console.log(JSON.stringify(first), JSON.stringify(second), first === second, second.length, second[0], second[1], second[2]);
for (let i = 0; i < 300; i++) {
    const list = make();
    if (list[0] !== undefined || list[1] !== null || list[2] !== undefined || list.length !== 3) console.log("changed at", i);
    list[i % 3] = i;
    list.length = i % 5;
}
console.log(JSON.stringify(make()));
