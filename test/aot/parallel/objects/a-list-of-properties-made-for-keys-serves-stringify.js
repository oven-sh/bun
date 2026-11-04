// The list of the properties of an object with extra properties serves Object.keys, copies, for-in and JSON.stringify. The text of the keys is written when JSON.stringify first asks, whoever made the list.
const key = process.env.NO_SUCH_NAME ?? "extra";
const made = [];
for (let turn = 0; turn < 3; turn++) {
  const object = { id: turn, title: "t" + turn };
  object[key] = turn;
  made.push(object);
}
console.log(Object.keys(made[0]).join(), JSON.stringify(made[0]));
console.log(JSON.stringify(made[1]), Object.keys(made[1]).join());
for (const name in made[2]) console.log(name);
console.log(JSON.stringify({ ...made[2], more: 1 }), JSON.stringify(made));
made[0].toJSON = () => "by toJSON";
console.log(JSON.stringify(made[0]), Object.entries(made[1]).join("|"), Object.values(made[2]).join());
