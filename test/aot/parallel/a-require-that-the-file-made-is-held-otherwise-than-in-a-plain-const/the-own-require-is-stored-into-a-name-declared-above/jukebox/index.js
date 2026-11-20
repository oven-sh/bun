"use strict";
let ask;
const songs = { hum: "mm mm" };
exports.lay = (title, words) => {
  songs[title] = words;
};
exports.sing = (...titles) => {
  for (const title of titles) {
    if (songs[title] !== undefined) continue;
    try {
      ask = require;
      ask("./songs/" + title);
    } catch {
      console.log("no", title);
    }
  }
  return titles.map(title => songs[title] ?? "(nothing)").join(" / ");
};
