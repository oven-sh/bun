const bookmarks = {
  group: ["https://www.google.com", "https://www.google.com"],
};
Object.entries(bookmarks).map(async ([group, links]) => {
  const a = await Promise.all(links.map(fetch));
});
