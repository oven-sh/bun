// Flags: --aot-testing=CheckWalkAtRunTime
// The calls of get() on the searchParams of a URL are answered out of the URL's text. The read of the method has no user but its call, and what the walk binds for it there stands in for nothing. Under the word that checks the walk that stand-in may not be held against the object.
function positive(text: string | null | undefined, fallback: number): number {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function postPage(userId: string, postId: string, page: string | null | undefined, limit: string | null | undefined, sort: string | null | undefined) {
  return { userId: Number(userId), postId, page: positive(page, 1), limit: Math.min(positive(limit, 20), 100), sort: sort ?? "new" };
}
const asked: [string, string][] = JSON.parse('[["/users/42/posts/hello?page=2&limit=10&sort=old","a"],["/users/%34%32/posts/hello%20world?page=abc&limit=1000&sort=x","b"],["/users/42/posts/caf%C3%A9?page=-1&limit=0","c"],["/users/42/posts/a%2Fb?page=1e1&limit=0x10","d"]]');
for (const [path] of asked) {
  const url = new URL("http://localhost" + path);
  const parts = url.pathname.split("/");
  const query = url.searchParams;
  console.log(JSON.stringify(postPage(parts[2]!, parts[4]!, query.get("page"), query.get("limit"), query.get("sort"))));
}
