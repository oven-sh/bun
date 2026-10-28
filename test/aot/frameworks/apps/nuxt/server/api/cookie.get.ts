export default defineEventHandler(event => {
  const had = Object.keys(parseCookies(event)).sort();
  setCookie(event, "who", "ada", { path: "/", httpOnly: true, sameSite: "lax" });
  deleteCookie(event, "gone", { path: "/" });
  return { had };
});
