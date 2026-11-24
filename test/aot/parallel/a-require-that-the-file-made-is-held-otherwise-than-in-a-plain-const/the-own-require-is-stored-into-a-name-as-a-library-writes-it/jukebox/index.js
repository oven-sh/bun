"use strict";
(function (root, make) {
  if (typeof module === "object" && module.exports) module.exports = make();
  else root.jukebox = make();
})(this, function () {
  const songs = new Map([["hum", "mm mm"]]);
  function fetchAll(titles) {
    let ask;
    try {
      ask = require;
      for (const title of titles) if (!songs.has(title)) ask("./songs/" + title);
    } catch (error) {
      console.log(titles.length, "asked for, one is missing");
    }
  }
  return {
    lay(title, words) {
      songs.set(title, words);
    },
    sing(...titles) {
      fetchAll(titles);
      return titles.map(title => songs.get(title) ?? "(nothing)").join(" / ");
    },
  };
});
