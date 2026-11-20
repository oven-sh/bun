const makeTable = require("./index.js");
const town = makeTable(), street = makeTable(), house = makeTable(), room = makeTable();
room.get("/", p => "room " + p.room + " of " + p.house);
room.get("/:thing", p => [p.town, p.street, p.house, p.room, p.thing].join(">"));
house.under("/rooms/:room", room);
house.get("/", p => "house " + p.house);
house.get("/door", (p, asked) => (asked.knocks > 2 ? "open " + p.house : undefined));
street.under("/:house", house);
street.get("/:house/door", p => "shut " + p.house);
town.under("/:town/streets/:street", street);
town.under("/", (p, asked) => { asked.lost = true; });
town.get("*", p => "lost at " + p.rest);
const asks = ["/oak/streets/elm/4", "/oak/streets/elm/4/", "/oak/streets/elm/4/door", "/oak/streets/elm/4/rooms/b", "/oak/streets/elm/4/rooms/b/lamp", "/oak/streets/elm/4/rooms", "/oak/streets/elm", "/oak", "", "/o%20k/streets/e%2Fm/9/rooms/c/d"];
for (const place of asks) {
  for (const knocks of [0, 3]) {
    const asked = { word: "get", place, knocks };
    console.log(place, knocks, town(asked), asked.lost === true);
  }
}
let sum = 0;
for (let turn = 0; turn < 500; turn++) {
  const asked = { word: turn % 9 ? "get" : "put", place: asks[turn % asks.length], knocks: turn % 4 };
  const said = town(asked);
  sum = (sum * 33 + (said === undefined ? 5 : said.length) + (asked.lost ? 1 : 0)) | 0;
}
console.log(sum, [town, street, house, room].map(table => table.signs.map(sign => sign.found).join("/")).join(" "));
room.get("/self", () => "never");
house.under("/loop/:n", house);
console.log(town({ word: "get", place: "/oak/streets/elm/4/loop/1/loop/2/door", knocks: 9 }), town({ word: "get", place: "/oak/streets/elm/4/loop/1/rooms/x" }));
