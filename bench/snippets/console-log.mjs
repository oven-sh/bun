import { Buffer } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

const json = {
  login: "wongmjane",
  id: 1332975,
  node_id: "MDQ6VXNlcjEzMzI5NzU=",
  avatar_url: "https://avatars.githubusercontent.com/u/1332975?v=4",
  gravatar_id: "",
  url: "https://api.github.com/users/wongmjane",
  html_url: "https://github.com/wongmjane",
  followers_url: "https://api.github.com/users/wongmjane/followers",
  following_url: "https://api.github.com/users/wongmjane/following{/other_user}",
  gists_url: "https://api.github.com/users/wongmjane/gists{/gist_id}",
  starred_url: "https://api.github.com/users/wongmjane/starred{/owner}{/repo}",
  subscriptions_url: "https://api.github.com/users/wongmjane/subscriptions",
  organizations_url: "https://api.github.com/users/wongmjane/orgs",
  repos_url: "https://api.github.com/users/wongmjane/repos",
  events_url: "https://api.github.com/users/wongmjane/events{/privacy}",
  received_events_url: "https://api.github.com/users/wongmjane/received_events",
  type: "User",
  site_admin: false,
  name: null,
  company: null,
  blog: "https://wongmjane.com",
  location: null,
  email: null,
  hireable: null,
  bio: null,
  twitter_username: "wongmjane",
  public_repos: 0,
  public_gists: 8,
  followers: 1197,
  following: 135,
  created_at: "2012-01-16T07:01:22Z",
  updated_at: "2022-11-23T16:12:24Z",
};

const inspect =
  "Bun" in globalThis ? Bun.inspect : "Deno" in globalThis ? Deno.inspect : (await import("util")).inspect;
bench("big json object", () => {
  console.error(json);
});

bench("inspect big json object", () => {
  console.error(inspect(json));
});

// A string in a list, and a string as a key that needs quotes, in 8-bit and in 16-bit storage of the engine.
// `JSON.parse`, `node:path` and `Buffer#toString` return 16-bit strings of text that 8 bits can hold.
const wide = text => Buffer.from(text, "utf16le").toString("utf16le");
const texts = {
  "ASCII": "abc-",
  "accents": "é",
  "lines": "a line of some text, 40 characters long\n",
  "line feeds": "\n",
  "CJK": "中",
  "emoji": "😀",
  "CJK lines": "中 and a line of some more text, 40 long\n",
  "CJK path": "C:\\日本\\ファイル\\",
  "Japanese": "吾輩は猫である。名前はまだ無い。\n",
  "curly quotes": "“It’s a line of some text,” she said…\n",
  "an unpaired surrogate": "abcdefghijklmno\ud800",
};
for (const [name, text] of Object.entries(texts)) {
  group(name, () => {
    for (const units of [8, 40, 1024, 100_000]) {
      const narrow = text.repeat(Math.ceil(units / text.length)).slice(0, units);
      // An 8-bit string cannot hold a character above U+00FF.
      const storages = /^[\x00-\xff]*$/.test(narrow)
        ? { "8-bit": narrow, "16-bit": wide(narrow) }
        : { "16-bit": narrow };
      for (const [storage, string] of Object.entries(storages)) {
        const list = [string];
        bench(`${storage} value, ${units} units`, () => inspect(list));
        if (units > 1024) continue;
        // Equal keys are one atom of one storage, so each storage has its own key. The engine makes an 8-bit
        // atom of a rope where the characters fit, so the 16-bit key is a flat string.
        const keyed = { [storage === "16-bit" ? wide(string + storage) : string + storage]: 1 };
        bench(`${storage} key, ${units} units`, () => inspect(keyed));
      }
    }
  });
}

await run();
