// A text is sought in a list of a hundred texts of one length: the last one, in another cell with the same letters; one that differs in its last letter alone; one of another length.
const list = JSON.parse("[" + Array.from({ length: 100 }, (_, i) => '"' + String(i).padStart(4, "k") + '"').join() + "]");
const [last, nearly, longer] = JSON.parse('["kk99","kk9x","kkk99"]');
for (let turn = 0; turn < 3; turn++)
  for (const sought of [last, nearly, longer])
    console.log("SAID", turn, sought, list.indexOf(sought), list.includes(sought));
