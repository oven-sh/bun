let litter = [];
function make(x) { litter = [{ x }, { x }]; return { x, tag: "v" + x }; }
async function waits(make, list) {
  let last = make(0);
  try {
    await list[0];
    last = make(1);
    await list[1];
    last = make(2);
    await list[2];
    last = make(3);
    await list[3];
    last = make(4);
    await list[4];
    last = make(5);
    await list[5];
    last = make(6);
    await list[6];
    last = make(7);
    await list[7];
    last = make(8);
    await list[8];
    last = make(9);
    await list[9];
    last = make(10);
    await list[10];
    last = make(11);
    await list[11];
    last = make(12);
    await list[12];
    last = make(13);
    await list[13];
    last = make(14);
    await list[14];
    last = make(15);
    await list[15];
    last = make(16);
    await list[16];
    last = make(17);
    await list[17];
    last = make(18);
    await list[18];
    last = make(19);
    await list[19];
    last = make(20);
    await list[20];
    last = make(21);
    await list[21];
    last = make(22);
    await list[22];
    last = make(23);
    await list[23];
    last = make(24);
    return "whole " + (await list[24]) + " " + last.tag;
  } catch (error) {
    return "caught " + error + " " + last.x + " " + last.tag;
  }
}
const lines = [];
for (let round = 0; round < Number(process.argv[2] ?? 1); round++) {
  for (let k = -1; k <= 24; k++) {
    const list = Array.from({ length: 25 }, (_, i) => i === k ? Promise.reject("at " + i) : Promise.resolve(i));
    const said = await waits(make, list);
    if (!round) lines.push(said);
    else if (said !== lines[k + 1]) { console.log("DIFFERS IN ROUND", round, said, lines[k + 1]); process.exit(1); }
  }
}
console.log(lines.join(" | "));
