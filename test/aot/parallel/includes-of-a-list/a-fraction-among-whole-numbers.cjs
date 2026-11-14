// A fraction is sought in lists of whole numbers, a short one and one of a hundred: it is nowhere. The whole number beside it is found.
const short = JSON.parse("[0,12,-7,3]"), long = JSON.parse("[" + Array.from({ length: 100 }, (_, i) => i).join() + "]");
const [fraction, whole] = JSON.parse("[2.5,12]");
for (let turn = 0; turn < 3; turn++)
  for (const list of [short, long])
    console.log("SAID", turn, list.length, list.indexOf(fraction), list.includes(fraction), list.indexOf(whole), list.includes(whole));
