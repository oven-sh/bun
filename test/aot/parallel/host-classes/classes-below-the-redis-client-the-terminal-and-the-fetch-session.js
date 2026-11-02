// A method and a getter of a class below a host class that makes the object itself: `'label' was not compiled into this executable`, and in a try the fall-back.
class Client extends Bun.RedisClient {
  label() { return "mine"; }
  get kind() { return "kind of mine"; }
}
class Session extends Bun.FetchSession {
  label() { return "mine"; }
  get kind() { return "kind of mine"; }
}
function tell(name, made, base, own) {
  let inTry = "fall-back";
  try { inTry = made.label(); } catch {}
  console.log(name, made.label(), made.kind, inTry, made instanceof base, made instanceof own);
  if (typeof made.close === "function") made.close();
}
tell("RedisClient", new Client("redis://127.0.0.1:1"), Bun.RedisClient, Client);
tell("FetchSession", new Session(), Bun.FetchSession, Session);
if (process.platform !== "win32") {
  class Screen extends Bun.Terminal {
    label() { return "mine"; }
    get kind() { return "kind of mine"; }
  }
  tell("Terminal", new Screen({}), Bun.Terminal, Screen);
}
